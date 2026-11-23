'use strict';

// Estado do trade -> tratamento (D294, D318 seção 4.7e). Função pura: não acessa banco nem rede.
// O critério de importação é a OFERTA ACEITA (`accepted_at` + `steam_offer.state = 3`), não o `state`: o `state` só diz se o
// trade terminou (`verified`), falhou (`failed`/`cancelled`) ou é desconhecido.
const { CSFLOAT_TRADE_STATES, STEAM_OFFER_STATES } = require('./adapters/csfloatStates');
const { IMPORT_OPEN_GRACE_MS } = require('../../config/constants');

// Registros já decididos que a importação não reavalia.
const FROZEN_TRACKINGS = Object.freeze(['REMOVED_IN_APP', 'IGNORED', 'NEEDS_REVIEW', 'REVERTED', 'BEFORE_CUTOFF', 'CLOSED_NOT_TRANSFERRED']);
// Trackings "fechados" para a parada incremental da varredura (D295). Desde a 9.3, DEFERRED (venda vista na 9.2) não é fechado:
// a venda é reavaliada e importada (a primeira importação da 9.3 faz a varredura completa).
const CLOSED_TRACKINGS = Object.freeze(['SETTLED', 'CLOSED_NOT_TRANSFERRED', 'BEFORE_CUTOFF', 'REMOVED_IN_APP', 'IGNORED']);

const lower = (state) => (typeof state === 'string' ? state.toLowerCase() : null);
const ms = (iso) => (iso ? Date.parse(iso) : NaN);

function stateKind(rawState) {
  const state = lower(rawState);
  if (state === null) return 'UNKNOWN';
  if (CSFLOAT_TRADE_STATES.done.includes(state)) return 'DONE';
  if (CSFLOAT_TRADE_STATES.failed.includes(state)) return 'FAILED';
  if (CSFLOAT_TRADE_STATES.open.includes(state)) return 'OPEN';
  return 'UNKNOWN';
}

// Oferta da Steam: nula (ainda não enviada) é "sem oferta"; fora do enum conhecido (ou o 1) é desconhecida.
const isOfferKnown = (offerState) => offerState === null || offerState === undefined || STEAM_OFFER_STATES.known.includes(offerState);
const isAccepted = (trade) => Boolean(trade.acceptedAt) && trade.offerState === STEAM_OFFER_STATES.accepted;

// Data da operação usada contra o corte: `contract.sold_at` (ou a criação do trade, sem ela).
const operationAt = (trade) => trade.soldAt || trade.createdAt;

// Fecha (SETTLED) ou mantém aberto (OPEN) um trade já ligado a um lançamento (9.4, D294): ele é acompanhado até o maior entre o fim
// da proteção e o `verify_sale_at`, mais a folga de 2 dias, mesmo já `verified` (a proteção da Steam ainda pode desfazer o trade).
// Depois disso, deixa de ser reverificado (só um estorno no extrato o reabre). Sem nenhuma das duas datas, `verified` fecha.
function settleTracking(trade, now) {
  const limits = [ms(trade.protectionEndsAt), ms(trade.verifySaleAt)].filter((value) => !Number.isNaN(value));
  if (limits.length) return now.getTime() > Math.max(...limits) + IMPORT_OPEN_GRACE_MS ? 'SETTLED' : 'OPEN';
  return lower(trade.rawState) === 'verified' ? 'SETTLED' : 'OPEN';
}

// Motivo da reversão (o sinal que a acusou), para o resumo.
const REVERT_REASONS = Object.freeze({ STATE: 'REVERTED_STATE_FAILED', OFFER: 'REVERTED_OFFER_CHANGED', REFUND: 'REVERTED_REFUND' });
const reverted = (reasonCode) => ({ kind: 'LINKED', tracking: 'REVERTED', count: 'reverted', entry: { outcome: 'REVERTED', reasonCode } });

// Decide o que fazer com um trade.
//   trade:    ExternalTrade (já normalizado pelo mapper)
//   direction: 'BUY' | 'SELL' (a direção desconhecida é tratada antes, pelo service)
//   existing: registro gravado (ou null); `hasLink`: já ligado a um lançamento do app
//   ctx:      { now: Date, cutoffMs: number, refundSignal: boolean, hasLink: boolean, keptReversal: boolean }
//             `keptReversal`: o usuário já escolheu "Manter" numa reversão deste trade (não volta a acusar).
// Devolve { kind, tracking, count, entry? }:
//   kind 'KEEP'   = nada muda (registro já decidido); `count` diz onde contar ('known', 'deferred'...)
//   kind 'MARK'   = grava o `tracking` (sem lançamento)
//   kind 'IMPORT' = compra ou venda aceita e segura: criar o lançamento ou ligar a um manual
//   kind 'LINKED' = trade já ligado: atualiza o `tracking` e, se for o caso, abre a entrada
// `entry`: { outcome, reasonCode } quando o resumo deve mostrar algo.
// `reopenBeforeCutoff` (9.5.1c, D325): o corte foi antecipado e este registro BEFORE_CUTOFF volta a ser avaliado contra o novo.
function classify(trade, direction, existing, {
  now, cutoffMs, refundSignal = false, hasLink = false, keptReversal = false, reopenBeforeCutoff = false,
}) {
  const kind = stateKind(trade.rawState);
  const offerKnown = isOfferKnown(trade.offerState);
  const stateKnown = kind !== 'UNKNOWN';
  const accepted = isAccepted(trade);

  // 1. Trade ligado a um lançamento: só reverifica.
  if (hasLink) {
    if (existing && existing.tracking === 'REVERTED') return { kind: 'KEEP', tracking: 'REVERTED', count: 'known' };
    if (existing && existing.tracking === 'REMOVED_IN_APP') return { kind: 'KEEP', tracking: 'REMOVED_IN_APP', count: 'known' };
    if (existing && existing.tracking === 'IGNORED') return { kind: 'KEEP', tracking: 'IGNORED', count: 'known' };
    if (keptReversal) return { kind: 'LINKED', tracking: 'SETTLED', count: 'known' };
    // Fechado e já passada a proteção/liberação + 2 dias: não é mais reverificado; só o estorno do extrato reabre. (Um SETTLED ainda
    // dentro da janela, fechado pela regra antiga do `verified`, volta a ser acompanhado.)
    if (existing && existing.tracking === 'SETTLED' && settleTracking(trade, now) === 'SETTLED') {
      return refundSignal ? reverted(REVERT_REASONS.REFUND) : { kind: 'KEEP', tracking: 'SETTLED', count: 'known' };
    }
    const offerLost = trade.offerState !== null && trade.offerState !== undefined && trade.offerState !== STEAM_OFFER_STATES.accepted;
    if (refundSignal) return reverted(REVERT_REASONS.REFUND);
    if (kind === 'FAILED') return reverted(REVERT_REASONS.STATE);
    if (offerLost) return reverted(REVERT_REASONS.OFFER);
    if (!stateKnown || !offerKnown) {
      return { kind: 'LINKED', tracking: 'UNKNOWN_STATE', count: 'unknownState', entry: { outcome: 'UNKNOWN_STATE', reasonCode: 'UNKNOWN_STATE' } };
    }
    return { kind: 'LINKED', tracking: settleTracking(trade, now), count: 'known' };
  }

  // 2. Registro já decidido (e sem lançamento): não muda. Um BEFORE_CUTOFF conta como "antes do corte" (a varredura completa
  //    mostra o número real do histórico, D324), salvo quando o corte foi antecipado até ele (reavaliado abaixo).
  const reopened = reopenBeforeCutoff && existing && existing.tracking === 'BEFORE_CUTOFF';
  if (existing && !reopened && FROZEN_TRACKINGS.includes(existing.tracking)) {
    return { kind: 'KEEP', tracking: existing.tracking, count: existing.tracking === 'BEFORE_CUTOFF' ? 'beforeCutoff' : 'known' };
  }

  // 3. Antes da data de corte.
  if (Date.parse(operationAt(trade)) < cutoffMs) return { kind: 'MARK', tracking: 'BEFORE_CUTOFF', count: 'beforeCutoff' };

  // 5. Enviado a outra pessoa.
  if (trade.sentToDifferentUser) {
    return { kind: 'MARK', tracking: 'RETRY', count: 'failed', entry: { outcome: 'FAILED', reasonCode: 'TRADE_SENT_TO_OTHER_USER' } };
  }

  // 6. Estorno ou rollback no extrato antes de importar: não importa ("revertido antes de importar").
  if (refundSignal) return { kind: 'MARK', tracking: 'CLOSED_NOT_TRANSFERRED', count: 'revertedBeforeImport' };

  // 7. Estado ou oferta desconhecidos: nunca importa por segurança.
  if (!stateKnown || !offerKnown) {
    return { kind: 'MARK', tracking: 'UNKNOWN_STATE', count: 'unknownState', entry: { outcome: 'UNKNOWN_STATE', reasonCode: 'UNKNOWN_STATE' } };
  }

  // 8. Compra ou venda: a mesma regra da oferta aceita (D294). A venda é importada desde a 9.3 (D299).
  if (!accepted) {
    // Falhou sem nunca ter sido aceita: não reverifica mais. Senão, o vendedor ainda pode enviar.
    return { kind: 'MARK', tracking: kind === 'FAILED' ? 'CLOSED_NOT_TRANSFERRED' : 'WAITING_TRANSFER', count: 'notTransferred' };
  }
  // Aceito e depois falhou/cancelado, nunca importado: "revertido antes de importar" (D294); não reverifica mais.
  if (kind === 'FAILED') return { kind: 'MARK', tracking: 'CLOSED_NOT_TRANSFERRED', count: 'revertedBeforeImport' };
  return { kind: 'IMPORT', tracking: settleTracking(trade, now), count: 'import' };
}

module.exports = { REVERT_REASONS, classify, settleTracking, stateKind, isAccepted, isOfferKnown, operationAt, FROZEN_TRACKINGS, CLOSED_TRACKINGS };
