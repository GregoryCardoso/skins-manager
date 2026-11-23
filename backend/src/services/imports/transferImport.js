'use strict';

// Aportes e saques importados do extrato do CSFloat (9.6; D306, D310, D311, E9-Q20). Os registros `deposit`/`withdrawal` já são
// gravados como "vistos" desde a 9.2; aqui eles viram aportes e saques do app, com uma data de corte PRÓPRIA (transactions_cutoff_at):
//   - sem a data de corte deles: nada é importado (o resumo conta quantos esperam por ela);
//   - antes dela: BEFORE_CUTOFF (o usuário já lançou à mão, ou o saldo dessa época está num aporte);
//   - depois: casa com o lançamento manual (mesma loja, mesmo valor, dia vizinho, a mesma regra de quantidade da D298) ou cria.
// Roda dentro da transação da importação (ou da resolução de uma pendência).
const Deposit = require('../../models/Deposit');
const Withdrawal = require('../../models/Withdrawal');
const ExternalRecord = require('../../models/ExternalRecord');
const ExternalLink = require('../../models/ExternalLink');
const ImportBatchEntry = require('../../models/ImportBatchEntry');
const { AppError } = require('../../errors/AppError');
const depositService = require('../depositService');
const withdrawalService = require('../withdrawalService');
const manualMatchService = require('./manualMatchService');

const SOURCE = 'CSFLOAT';
const TRANSFER_TYPES = Object.freeze({ deposit: 'DEPOSIT', withdrawal: 'WITHDRAWAL' });

// Aporte ou saque de um registro do extrato (função pura). Aporte: creditado = balance_offset (> 0), taxa = details.fee.
// Saque: sacado = |balance_offset| (< 0), taxa = float_fee + processor_fee (D310). Devolve { kind, amountStoreCents, feeCents, at }
// ou { error } quando o valor não serve.
function transferOf(record) {
  const kind = TRANSFER_TYPES[record.txType];
  if (!kind) return { error: 'SOURCE_RECORD_INVALID' };
  const offset = record.balanceOffsetCents;
  if (!Number.isSafeInteger(offset) || (kind === 'DEPOSIT' ? offset <= 0 : offset >= 0)) return { error: 'SOURCE_RECORD_INVALID' };
  const amountStoreCents = Math.abs(offset);
  const feeCents = record.feeCents ?? null;
  if (kind === 'WITHDRAWAL' && feeCents !== null && feeCents > amountStoreCents) return { error: 'WITHDRAWAL_FEE_ABOVE_AMOUNT' };
  return { kind, amountStoreCents, feeCents, at: record.externalCreatedAt };
}

// Dados neutros para o resumo (sem dados pessoais nem de pagamento).
const displayOf = (record, transfer) => ({
  txKind: transfer && !transfer.error ? transfer.kind : TRANSFER_TYPES[record.txType] ?? null,
  amountCents: transfer && !transfer.error ? transfer.amountStoreCents : Math.abs(record.balanceOffsetCents ?? 0),
  feeCents: record.feeCents ?? null,
  priceCents: transfer && !transfer.error ? transfer.amountStoreCents : null,
  currency: 'USD',
  date: record.externalCreatedAt,
});

// Cria o aporte/saque pelo service (as mesmas validações do lançamento manual). `amountBrl` fica nulo (opcional e informativo).
function createTransfer(transfer, store, { now }) {
  if (transfer.kind === 'DEPOSIT') {
    const view = depositService.createDeposit(
      { storeId: store.id, amountStoreCents: transfer.amountStoreCents, feeCents: transfer.feeCents, depositedAt: transfer.at }, { now }
    );
    return Deposit.findById(view.id);
  }
  const view = withdrawalService.createWithdrawal(
    { storeId: store.id, amountStoreCents: transfer.amountStoreCents, feeCents: transfer.feeCents, withdrawnAt: transfer.at }, { now }
  );
  return Withdrawal.findById(view.id);
}

// Aviso do saque (D310): a taxa cobrada difere da sugerida pelas taxas de saque da loja (que são só informativas).
function withdrawalFeeMismatch(transfer, store) {
  if (transfer.kind !== 'WITHDRAWAL' || transfer.feeCents === null) return false;
  try {
    const { suggestedFeeCents } = withdrawalService.suggestWithdrawalFeeCents(transfer.amountStoreCents, store);
    return suggestedFeeCents !== null && suggestedFeeCents !== transfer.feeCents;
  } catch (err) {
    if (err instanceof AppError) return false;
    throw err;
  }
}

// Candidatos ao casamento: aportes/saques manuais da loja, sem vínculo, a partir do dia anterior ao corte.
function candidatesFor(kind, storeId, fromIso) {
  const fromMs = Date.parse(fromIso);
  const linkType = kind;
  const rows = kind === 'DEPOSIT' ? Deposit.findAll() : Withdrawal.findAll();
  const dateOf = (row) => (kind === 'DEPOSIT' ? row.depositedAt : row.withdrawnAt);
  return rows
    .filter((row) => row.storeId === storeId && row.amountStoreCents !== null && Date.parse(dateOf(row)) >= fromMs)
    .filter((row) => !ExternalLink.findByEntity(linkType, row.id))
    .map((row) => ({ ...row, catalogId: kind, category: 'OUTRO', name: kind, opAt: dateOf(row) }));
}

function startOfPreviousLocalDay(iso) {
  const date = new Date(iso);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - 1);
  return date.toISOString();
}

const isAfterOrAt = (iso, cutoffIso) => Date.parse(iso) >= Date.parse(cutoffIso);

// Processa os aportes e saques do extrato que ainda não viraram lançamento. `ctx`: { batch, store, now, counts, addEntry,
// cutoffAt (o corte deles, ou null), diagnostics }.
function processTransfers(ctx) {
  const { batch, store, now, counts, addEntry, cutoffAt, diagnostics } = ctx;
  const pending = ExternalRecord.listUnlinkedTransfers(SOURCE, ['SEEN', 'RETRY']);
  if (!cutoffAt) {
    diagnostics.transfersAwaitingCutoff = pending.length;
    return;
  }
  // Antes do corte: o usuário já lançou à mão (ou está num aporte). Pendências abertas desses registros são fechadas.
  for (const id of ExternalRecord.closeTransfersBefore(SOURCE, cutoffAt, { now })) {
    ImportBatchEntry.resolveOpenForRecord(id, 'IGNORED', { now });
  }
  const toProcess = pending.filter((record) => isAfterOrAt(record.externalCreatedAt, cutoffAt));
  diagnostics.transfersBeforeCutoff = ExternalRecord.countUnlinkedTransfers(SOURCE, ['BEFORE_CUTOFF']);
  if (!toProcess.length) return;

  const prepared = [];
  for (const record of toProcess) {
    const transfer = transferOf(record);
    if (transfer.error) {
      counts.failed += 1;
      ExternalRecord.update(record.id, { tracking: 'RETRY', lastBatchId: batch.id }, { now });
      addEntry(record, { outcome: 'FAILED', reasonCode: transfer.error, display: displayOf(record, null) });
      continue;
    }
    prepared.push({ record, transfer });
  }
  const from = startOfPreviousLocalDay(cutoffAt);
  for (const kind of ['DEPOSIT', 'WITHDRAWAL']) {
    const ofKind = prepared.filter((p) => p.transfer.kind === kind);
    if (!ofKind.length) continue;
    const matches = manualMatchService.matchTransfers(
      ofKind.map(({ record, transfer }) => ({ key: record.id, kind, amountCents: transfer.amountStoreCents, date: transfer.at })),
      candidatesFor(kind, store.id, from)
    );
    for (const { record, transfer } of ofKind) {
      const display = displayOf(record, transfer);
      const match = matches.get(record.id) || { kind: 'NONE' };
      if (match.kind === 'AMBIGUOUS') {
        ExternalRecord.update(record.id, { tracking: 'NEEDS_REVIEW', lastBatchId: batch.id }, { now });
        counts.review += 1;
        addEntry(record, { outcome: 'POSSIBLE_DUPLICATE', reasonCode: null, candidateIds: match.candidateIds, display });
        continue;
      }
      if (match.kind === 'MATCH') {
        const entity = kind === 'DEPOSIT' ? Deposit.findById(match.itemId) : Withdrawal.findById(match.itemId);
        linkTransfer(record, kind, entity, 'MATCHED', batch.id, { now });
        ImportBatchEntry.resolveOpenForRecord(record.id, 'LINKED', { now });
        counts.matched += 1;
        addEntry(record, { outcome: 'MATCHED', reasonCode: null, entityType: kind, entityId: entity.id, display });
        continue;
      }
      let entity;
      try {
        entity = createTransfer(transfer, store, { now });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        counts.failed += 1;
        ExternalRecord.update(record.id, { tracking: 'RETRY', lastBatchId: batch.id }, { now });
        addEntry(record, { outcome: 'FAILED', reasonCode: String(err.code || 'INVALID').slice(0, 60), display });
        continue;
      }
      linkTransfer(record, kind, entity, 'CREATED', batch.id, { now });
      ImportBatchEntry.resolveOpenForRecord(record.id, 'CREATED', { now });
      if (kind === 'DEPOSIT') counts.depositsCreated += 1;
      else counts.withdrawalsCreated += 1;
      addEntry(record, {
        outcome: 'CREATED', reasonCode: withdrawalFeeMismatch(transfer, store) ? 'WITHDRAWAL_FEE_MISMATCH' : null, entityType: kind,
        entityId: entity.id, display,
      });
    }
  }
}

function linkTransfer(record, kind, entity, linkKind, batchId, { now }) {
  ExternalLink.create({ recordId: record.id, entityType: kind, entityId: entity.id, linkKind, batchId, entityUpdatedAt: entity.updatedAt }, { now });
  ExternalRecord.update(record.id, { tracking: 'SETTLED', lastBatchId: batchId }, { now });
}

// Pré-visualização local (sem rede) da data de corte dos aportes e saques: o que já foi visto no extrato a partir da data nova
// (até a atual, se houver) e os lançamentos manuais do mesmo intervalo (serão ligados quando baterem).
function previewTransferCutoff({ storeId, currentCutoffAt, newCutoffAt }) {
  const newMs = Date.parse(newCutoffAt);
  const endMs = currentCutoffAt ? Date.parse(currentCutoffAt) : Infinity;
  const inRange = (iso) => {
    const ms = Date.parse(iso);
    return ms >= newMs && ms < endMs;
  };
  const records = ExternalRecord.listUnlinkedTransfers(SOURCE, ['SEEN', 'RETRY', 'BEFORE_CUTOFF']).filter((r) => inRange(r.externalCreatedAt));
  const sum = (type) => {
    const list = records.filter((r) => r.txType === type);
    return { count: list.length, amountCents: list.reduce((total, r) => total + Math.abs(r.balanceOffsetCents ?? 0), 0) };
  };
  const manualDeposits = Deposit.findAll().filter((d) => d.storeId === storeId && d.amountStoreCents !== null && inRange(d.depositedAt)
    && !ExternalLink.findByEntity('DEPOSIT', d.id));
  const manualWithdrawals = Withdrawal.findAll().filter((w) => w.storeId === storeId && inRange(w.withdrawnAt)
    && !ExternalLink.findByEntity('WITHDRAWAL', w.id));
  // Adiar: os ainda não importados antes da data nova são fechados (o que já virou lançamento continua).
  const openToClose = ExternalRecord.listUnlinkedTransfers(SOURCE, ['SEEN', 'RETRY', 'NEEDS_REVIEW'])
    .filter((r) => Date.parse(r.externalCreatedAt) < newMs).length;
  return {
    deposits: sum('deposit'),
    withdrawals: sum('withdrawal'),
    openToClose,
    // A primeira definição (ou uma data mais antiga) relê o extrato inteiro: pode haver aportes que o app nunca leu.
    mayHaveUnseen: newMs < endMs,
    manualDeposits: manualDeposits.map((d) => ({ id: d.id, depositedAt: d.depositedAt, amountStoreCents: d.amountStoreCents })),
    manualWithdrawals: manualWithdrawals.length,
  };
}

module.exports = { TRANSFER_TYPES, transferOf, displayOf, createTransfer, processTransfers, linkTransfer, previewTransferCutoff };
