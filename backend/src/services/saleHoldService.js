'use strict';

// Retenção do saldo após a venda (2.8, D214, D239). Funções puras com `now`: nada é gravado, tudo é calculado na hora.
// A liberação é um instante exato em UTC: `soldAt + saleHoldDaysApplied × 24 h` (não é dia de calendário). Venda importada do
// CSFloat (D312): vale a liberação real `saleReleaseAt` (o `verify_sale_at` ou o `trade_verified`), quando informada.
const DAY_MS = 24 * 60 * 60 * 1000;

const isNil = (value) => value === null || value === undefined;

// Liberação real gravada pela importação (ms), ou null.
function informedReleaseMs(item) {
  if (isNil(item.saleReleaseAt)) return null;
  const ms = Date.parse(item.saleReleaseAt);
  return Number.isNaN(ms) ? null : ms;
}

// Instante (ms) da liberação de uma venda, ou null quando a retenção não foi registrada (venda anterior à v6).
function releaseMsOf(item) {
  const informed = informedReleaseMs(item);
  if (informed !== null) return informed;
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

const toMs = (value) => (value instanceof Date ? value.getTime() : Date.parse(value));

// Instante (ms) da liberação de uma venda para o saldo calculado (D239, D244): `soldAt + retenção × 24 h`, com a
// retenção nula (venda anterior à v6) valendo 0; na venda importada, a liberação real (D312). `null` se a data da venda for
// inválida.
function releaseInstantOf(item) {
  if (isNil(item.soldAt)) return null;
  const soldMs = Date.parse(item.soldAt);
  if (Number.isNaN(soldMs)) return null;
  const informed = informedReleaseMs(item);
  if (informed !== null) return informed;
  return soldMs + (isNil(item.saleHoldDaysApplied) ? 0 : item.saleHoldDaysApplied) * DAY_MS;
}

// Vendas de uma loja separadas em liberadas e pendentes num instante `at` (D239, D252). Sem corte por data.
// Considera só vendas com `soldAt <= at`:
// - liberada: `liberação <= at`;
// - pendente: `liberação > at`; `nextReleaseAt` é a menor liberação pendente e `lastReleaseAt` a maior (quando tudo estará liberado;
//   aditivo, 12.12: com várias vendas retidas, só a próxima data dava a entender que tudo liberava nela). `releases` lista o que
//   libera em cada instante (líquido somado e quantas vendas), em ordem, para a tela mostrar "quanto libera quando".
// Soma o líquido (`netReceivedCents`) na moeda da loja. O chamador filtra moedas divergentes.
function splitStoreSales({ storeId, sales = [], at }) {
  const atMs = toMs(at);
  const released = { cents: 0, count: 0 };
  const pending = { cents: 0, count: 0, nextReleaseAt: null, lastReleaseAt: null, releases: [] };
  const byRelease = new Map();
  let nextMs = null;
  let lastMs = null;
  for (const sale of sales) {
    if (sale.status !== 'VENDIDO' || sale.saleStoreId !== storeId) continue;
    const soldMs = Date.parse(sale.soldAt);
    const releaseMs = releaseInstantOf(sale);
    if (releaseMs === null || Number.isNaN(soldMs) || soldMs > atMs) continue;
    if (releaseMs > atMs) {
      pending.cents += sale.netReceivedCents;
      pending.count += 1;
      if (nextMs === null || releaseMs < nextMs) nextMs = releaseMs;
      if (lastMs === null || releaseMs > lastMs) lastMs = releaseMs;
      const slot = byRelease.get(releaseMs) ?? { cents: 0, count: 0 };
      slot.cents += sale.netReceivedCents;
      slot.count += 1;
      byRelease.set(releaseMs, slot);
    } else {
      released.cents += sale.netReceivedCents;
      released.count += 1;
    }
  }
  pending.nextReleaseAt = nextMs === null ? null : new Date(nextMs).toISOString();
  pending.lastReleaseAt = lastMs === null ? null : new Date(lastMs).toISOString();
  pending.releases = [...byRelease.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ms, slot]) => ({ releaseAt: new Date(ms).toISOString(), cents: slot.cents, count: slot.count }));
  return { released, pending };
}

module.exports = { DAY_MS, computeSaleRelease, releaseInstantOf, splitStoreSales };
