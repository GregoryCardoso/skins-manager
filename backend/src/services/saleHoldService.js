'use strict';

// Retenção do saldo após a venda (2.8, D214, D215). Funções puras com `now`: nada é gravado, tudo é calculado na hora.
// A liberação é um instante exato em UTC: `soldAt + saleHoldDaysApplied × 24 h` (não é dia de calendário).
const DAY_MS = 24 * 60 * 60 * 1000;

const isNil = (value) => value === null || value === undefined;

// Instante (ms) da liberação de uma venda, ou null quando a retenção não foi registrada (venda anterior à v6).
function releaseMsOf(item) {
  if (isNil(item.saleHoldDaysApplied) || isNil(item.soldAt)) return null;
  const soldMs = Date.parse(item.soldAt);
  if (Number.isNaN(soldMs)) return null;
  return soldMs + item.saleHoldDaysApplied * DAY_MS;
}

// `{ releasesAt, isHeld }` da venda; `null` se o item não está vendido. Venda sem retenção registrada:
// `releasesAt: null` e liberada. Retida enquanto `now < releasesAt`; na igualdade, já está liberada.
function computeSaleRelease(item, now = new Date()) {
  if (!item || item.status !== 'VENDIDO') return null;
  const releaseMs = releaseMsOf(item);
  if (releaseMs === null) return { releasesAt: null, isHeld: false };
  return { releasesAt: new Date(releaseMs).toISOString(), isHeld: now.getTime() < releaseMs };
}

// Vendas de uma loja que entram na conta além do saldo registrado (D215, E8-Q15): retenção > 0 e liberação
// posterior ao `recordedAt` do último saldo (sem saldo, todas). Duas categorias, somadas pelo líquido na moeda da loja:
// pendente (now < liberação) e liberado após o último registro (recordedAt < liberação <= now).
function computeHeldSalesForStore({ storeId, sales = [], latestBalance = null, now = new Date() }) {
  const nowMs = now.getTime();
  const recordedMs = latestBalance ? Date.parse(latestBalance.recordedAt) : null;
  const pending = { cents: 0, count: 0, nextReleaseAt: null };
  const released = { cents: 0, count: 0, earliestReleasedAt: null };
  let nextMs = null;
  let earliestMs = null;
  for (const sale of sales) {
    if (sale.status !== 'VENDIDO' || sale.saleStoreId !== storeId) continue;
    if (!(sale.saleHoldDaysApplied > 0)) continue; // retenção 0 ou nula nunca entra
    const releaseMs = releaseMsOf(sale);
    if (releaseMs === null) continue;
    if (recordedMs !== null && !(releaseMs > recordedMs)) continue; // já estava liberada no saldo registrado
    if (nowMs < releaseMs) {
      pending.cents += sale.netReceivedCents;
      pending.count += 1;
      if (nextMs === null || releaseMs < nextMs) nextMs = releaseMs;
    } else {
      released.cents += sale.netReceivedCents;
      released.count += 1;
      if (earliestMs === null || releaseMs < earliestMs) earliestMs = releaseMs;
    }
  }
  pending.nextReleaseAt = nextMs === null ? null : new Date(nextMs).toISOString();
  released.earliestReleasedAt = earliestMs === null ? null : new Date(earliestMs).toISOString();
  return { pending, releasedAfterBalance: released };
}

module.exports = { DAY_MS, computeSaleRelease, computeHeldSalesForStore };
