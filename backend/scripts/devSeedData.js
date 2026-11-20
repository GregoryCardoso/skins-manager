'use strict';

// Dados de exemplo (D108). Lista declarativa; todas as datas são relativas ao `now` do seed.
// `catalog` é resolvido por nome canônico + categoria (+ fase); OUTRO tem nome livre.
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// `now − N dias − 1 h`: evita mudar de faixa de idade durante o dia.
const acquiredAtFor = (now, daysAgo) => new Date(now.getTime() - daysAgo * DAY_MS - HOUR_MS);
const inFuture = (now, ms) => new Date(now.getTime() + ms);

const INSPECT = (n) => `steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20S76561198000000000A${n}D1000000000000000001`;

// Estoque. `lockMs`: trade lock restante a partir de `now`. Preços em centavos da moeda da loja.
const STOCK_ITEMS = [
  { catalog: { name: 'AK-47 | Redline', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.2134, paintSeed: 661, store: 'CSFloat', priceCents: 4500, daysAgo: 1, lockMs: 6 * DAY_MS, inspectLink: INSPECT(1) },
  { catalog: { name: 'AWP | Asiimov', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.3012, store: 'CSFloat', priceCents: 3800, daysAgo: 3, lockMs: 3 * HOUR_MS },
  { catalog: { name: 'Glock-18 | Fade', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.012, paintSeed: 412, store: 'CSFloat', priceCents: 12000, daysAgo: 7, inspectLink: INSPECT(2) },
  { catalog: { name: 'USP-S | Kill Confirmed', category: 'SKIN' }, variant: 'STATTRAK', floatValue: 0.09, store: 'CSFloat', priceCents: 6800, daysAgo: 8 },
  { catalog: { name: '★ Karambit | Doppler', category: 'FACA', phase: 'Phase 2' }, variant: 'STATTRAK', floatValue: 0.015, paintSeed: 87, store: 'CSFloat', priceCents: 85000, daysAgo: 12, lockMs: 29 * HOUR_MS, inspectLink: INSPECT(3) },
  { catalog: { name: '★ Sport Gloves | Vice', category: 'LUVA' }, variant: 'NORMAL', floatValue: 0.25, store: 'CSMoney', priceCents: 120000, daysAgo: 21 },
  { catalog: { name: 'Kilowatt Case', category: 'CAIXA' }, ganhei: true, originDetail: 'Mimo semanal', daysAgo: 22 },
  { catalog: { name: 'Revolution Case', category: 'CAIXA' }, store: 'Steam', priceCents: 350, fxRateAtPurchase: 5.3, daysAgo: 30 },
  { catalog: { name: 'Sticker | Shooter', category: 'STICKER' }, store: 'Steam', priceCents: 1500, fxRateAtPurchase: 5.25, daysAgo: 40 },
  { catalog: { name: 'Berlin 2019 Legends (Holo/Foil)', category: 'CAPSULA' }, store: 'Steam', priceCents: 2200, fxRateAtPurchase: 5.3, daysAgo: 12 },
  { catalog: { name: "Charm | Lil' Ava", category: 'PINGENTE' }, ganhei: true, originDetail: 'Drop de operação', daysAgo: 22 },
  { catalog: { name: 'Bloody Darryl The Strapped | The Professionals', category: 'PERSONAGEM' }, store: 'CSFloat', priceCents: 1200, daysAgo: 8 },
  { free: { name: 'Chave de exemplo', category: 'OUTRO' }, ganhei: true, originDetail: 'Item de nome livre', daysAgo: 3 },
];

// Vendidos. `soldDaysAgo`: dias entre a venda e `now`. `unlockAfterDays`: trade lock que já terminou antes da venda.
const SOLD_ITEMS = [
  {
    item: { catalog: { name: 'AK-47 | Redline', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.12, store: 'CSFloat', priceCents: 3900, daysAgo: 15, inspectLink: INSPECT(4) },
    sale: { store: 'CSFloat', priceCents: 5200, soldDaysAgo: 5 },
  },
  {
    item: { catalog: { name: 'Revolution Case', category: 'CAIXA' }, store: 'Steam', priceCents: 300, fxRateAtPurchase: 5.2, daysAgo: 20 },
    sale: { store: 'Steam', priceCents: 480, soldDaysAgo: 2 },
  },
  {
    item: { catalog: { name: 'AWP | Asiimov', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.52, store: 'CSFloat', priceCents: 2500, daysAgo: 25, unlockAfterDays: 7 },
    sale: { store: 'CSFloat', priceCents: 3400, soldDaysAgo: 1 },
  },
];

module.exports = { DAY_MS, HOUR_MS, STOCK_ITEMS, SOLD_ITEMS, acquiredAtFor, inFuture, DEV_FX_RATE: 5.4 };
