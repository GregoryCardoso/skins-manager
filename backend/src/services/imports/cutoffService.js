'use strict';

// Data de corte da primeira importação (D296, D318 seção 5). A sugestão é só o valor inicial do campo: o usuário pode editá-la.
const Item = require('../../models/Item');
const Deposit = require('../../models/Deposit');
const ExternalRecord = require('../../models/ExternalRecord');
const ExternalLink = require('../../models/ExternalLink');
const { IMPORT_RECHECK_WINDOW_MS } = require('../../config/constants');
const { parseDate } = require('../dateUtils');
const { ValidationError } = require('../../errors/AppError');

// Função pura: a mais recente entre as datas informadas (ISO), ou null se não houver nenhuma.
function pickLatest(dates) {
  const valid = dates.filter((d) => typeof d === 'string' && d !== '');
  if (valid.length === 0) return null;
  return valid.reduce((best, current) => (Date.parse(current) > Date.parse(best) ? current : best));
}

// Sugestão = a mais recente entre: a compra manual (sem vínculo) na loja, a venda manual (sem vínculo) nela e o último aporte
// nela. Sem nada disso, nulo (o modal começa vazio e exige a data).
function suggest({ storeId }) {
  if (storeId === null || storeId === undefined) return null;
  const { purchaseAt, saleAt } = Item.latestUnlinkedDates(storeId);
  return pickLatest([purchaseAt, saleAt, Deposit.maxDepositedAt(storeId)]);
}

// Valida o corte informado: obrigatório (IMPORT_CUTOFF_REQUIRED), ISO válido (INVALID_DATE) e não futuro (DATE_IN_FUTURE).
// Devolve o ISO em UTC.
function validateCutoff(value, { now = new Date() } = {}) {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError('Informe a data de corte.', 'IMPORT_CUTOFF_REQUIRED', { field: 'cutoffAt' });
  }
  const date = parseDate(value, 'Data de corte', { field: 'cutoffAt' });
  if (date.getTime() > now.getTime()) {
    throw new ValidationError('A data de corte não pode ser futura.', 'DATE_IN_FUTURE', { field: 'cutoffAt' });
  }
  return date.toISOString();
}

// Mudança do corte (D325): obrigatória, válida, não futura e diferente da atual. Devolve { iso, direction }.
function validateCutoffChange(value, currentCutoffAt, { now = new Date() } = {}) {
  const iso = validateCutoff(value, { now });
  if (Date.parse(iso) === Date.parse(currentCutoffAt)) {
    throw new ValidationError('A data de corte nova é igual à atual.', 'IMPORT_CUTOFF_UNCHANGED', { field: 'cutoffAt' });
  }
  return { iso, direction: Date.parse(iso) < Date.parse(currentCutoffAt) ? 'BACKWARD' : 'FORWARD' };
}

const operationAt = (record) => record.soldAt || record.externalCreatedAt;
const inRange = (iso, fromMs, toMs) => {
  const ms = Date.parse(iso);
  return ms >= fromMs && ms < toMs;
};
const OPEN = ['RETRY', 'WAITING_TRANSFER', 'UNKNOWN_STATE', 'NEEDS_REVIEW', 'DEFERRED'];

// Pré-visualização local (sem rede) do efeito da mudança de corte (D325).
//   BACKWARD: até quantas compras/vendas antes do corte (já vistas) podem entrar, se há trades nunca lidos, os aportes na loja no
//             intervalo (o sinal de aporte-base) e os lançamentos manuais do intervalo (serão ligados quando baterem).
//   FORWARD:  quantos lançamentos importados no intervalo continuam no app e quantas pendências/trades abertos serão fechados.
function previewCutoffChange({ storeId, currentCutoffAt, newCutoffAt }) {
  const currentMs = Date.parse(currentCutoffAt);
  const newMs = Date.parse(newCutoffAt);
  const records = ExternalRecord.listTrades('CSFLOAT');
  const links = ExternalLink.findByRecordIds(records.map((r) => r.id));
  const base = { currentCutoffAt, newCutoffAt, direction: newMs < currentMs ? 'BACKWARD' : 'FORWARD', backward: null, forward: null };
  if (newMs < currentMs) {
    const sum = (direction) => {
      const list = records.filter((r) => r.tracking === 'BEFORE_CUTOFF' && !links.has(r.id) && r.direction === direction
        && inRange(operationAt(r), newMs, currentMs));
      return { count: list.length, amountCents: list.reduce((total, r) => total + (r.amountCents || 0), 0) };
    };
    const deposits = Deposit.findAll()
      .filter((d) => d.storeId === storeId && inRange(d.depositedAt, newMs, currentMs))
      .map((d) => ({ id: d.id, depositedAt: d.depositedAt, amountStoreCents: d.amountStoreCents ?? null }));
    const fromIso = new Date(newMs).toISOString();
    const purchases = Item.findUnlinkedPurchases(storeId, { acquiredFrom: fromIso }).filter((i) => Date.parse(i.acquiredAt) < currentMs).length;
    const sales = Item.findUnlinkedSales(storeId, { soldFrom: fromIso }).filter((i) => Date.parse(i.soldAt) < currentMs).length;
    return {
      ...base,
      backward: {
        purchases: sum('BUY'),
        sales: sum('SELL'),
        mayHaveUnseen: newMs < currentMs - IMPORT_RECHECK_WINDOW_MS,
        deposits,
        manualLaunches: { purchases, sales },
      },
    };
  }
  const importedKept = records.filter((r) => links.has(r.id) && inRange(operationAt(r), currentMs, newMs)).length;
  const openToClose = records.filter((r) => !links.has(r.id) && OPEN.includes(r.tracking) && Date.parse(operationAt(r)) < newMs).length;
  return { ...base, forward: { importedKept, openToClose } };
}

module.exports = { pickLatest, suggest, validateCutoff, validateCutoffChange, previewCutoffChange };
