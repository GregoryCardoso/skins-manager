'use strict';

// Quando parar de paginar (D295, D318 seção 4). Funções puras: recebem números (ms) e booleanos, nunca tocam banco ou rede.
const { CSFLOAT_MAX_PAGES, IMPORT_RECHECK_WINDOW_MS } = require('../../config/constants');

// Fim da lista: página vazia, ou as páginas lidas já cobrem `count`.
function isEndOfList({ page, limit, count, pageSize }) {
  return pageSize === 0 || (page + 1) * limit >= count;
}

// Extrato (order=desc). Para quando:
//   - a lista acabou ('END');
//   - bateu o teto de páginas ('LIMIT'; o service avisa SCAN_LIMIT_REACHED);
//   - sem varredura completa, a transação mais antiga da página é anterior ao limite ('KNOWN'): com cursor, a data da transação do
//     cursor menos a janela; na primeira importação, o corte menos a janela.
// Devolve { stop: boolean, reason: 'END' | 'LIMIT' | 'KNOWN' | null }.
function shouldStopTransactions({ page, limit, count, pageSize, oldestMs, cursorCreatedMs = null, cutoffMs = null, fullScan = false, maxPages = CSFLOAT_MAX_PAGES }) {
  if (isEndOfList({ page, limit, count, pageSize })) return { stop: true, reason: 'END' };
  if (page + 1 >= maxPages) return { stop: true, reason: 'LIMIT' };
  if (fullScan) return { stop: false, reason: null };
  const base = cursorCreatedMs !== null ? cursorCreatedMs : cutoffMs;
  if (base !== null && Number.isFinite(oldestMs) && oldestMs < base - IMPORT_RECHECK_WINDOW_MS) return { stop: true, reason: 'KNOWN' };
  return { stop: false, reason: null };
}

// Trades. Para quando:
//   - a lista acabou ('END') ou bateu o teto ('LIMIT');
//   - sem `fullScan` e com a ordem íntegra:
//       primeira importação: o trade mais antigo da página é anterior ao corte menos a janela ('CUTOFF');
//       demais: todos os trades da página já são conhecidos e fechados E o mais antigo é anterior ao horizonte ('KNOWN').
// `horizonMs`: o mais antigo entre os registros abertos, as transações novas sem trade conhecido e `last_import_at - janela`.
function shouldStopTrades({
  page, limit, count, pageSize, oldestMs, allClosed, horizonMs = null, cutoffMs = null, fullScan = false, firstImport = false,
  orderBroken = false, maxPages = CSFLOAT_MAX_PAGES,
}) {
  if (isEndOfList({ page, limit, count, pageSize })) return { stop: true, reason: 'END' };
  if (page + 1 >= maxPages) return { stop: true, reason: 'LIMIT' };
  if (fullScan || orderBroken) return { stop: false, reason: null };
  if (!Number.isFinite(oldestMs)) return { stop: false, reason: null };
  if (firstImport) {
    if (cutoffMs !== null && oldestMs < cutoffMs - IMPORT_RECHECK_WINDOW_MS) return { stop: true, reason: 'CUTOFF' };
    return { stop: false, reason: null };
  }
  if (allClosed && horizonMs !== null && oldestMs < horizonMs) return { stop: true, reason: 'KNOWN' };
  return { stop: false, reason: null };
}

// O horizonte de reverificação: o instante mais antigo entre as fontes informadas (nulas são ignoradas). Sem nenhuma, nulo.
function computeHorizon({ openRecordsOldestMs = null, newTransactionsOldestMs = null, lastImportMs = null }) {
  const candidates = [];
  if (openRecordsOldestMs !== null && Number.isFinite(openRecordsOldestMs)) candidates.push(openRecordsOldestMs);
  if (newTransactionsOldestMs !== null && Number.isFinite(newTransactionsOldestMs)) candidates.push(newTransactionsOldestMs);
  if (lastImportMs !== null && Number.isFinite(lastImportMs)) candidates.push(lastImportMs - IMPORT_RECHECK_WINDOW_MS);
  return candidates.length ? Math.min(...candidates) : null;
}

// Ordem dos trades: a lista deve vir da mais nova para a mais antiga. Devolve true se algum `createdAt` (ms) for maior que o
// anterior (`previousMs` = o último da página anterior, ou nulo na primeira).
function isOrderBroken(createdMsList, previousMs = null) {
  let previous = previousMs;
  for (const value of createdMsList) {
    if (previous !== null && value > previous) return true;
    previous = value;
  }
  return false;
}

module.exports = { shouldStopTransactions, shouldStopTrades, computeHorizon, isOrderBroken, isEndOfList };
