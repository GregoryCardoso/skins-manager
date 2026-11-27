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

// --- Banco de exemplo ampliado (12.11): dados fictícios para capturas de tela e para o `npm run dev:demo`. -------------------------
// Lojas novas além das padrão (CSFloat/Steam/CSMoney): uma em EUR e uma em JPY (sem casas decimais: valores em múltiplos de 100).
const EXTRA_STORES = [
  { name: 'Loja EUR', currency: 'EUR', saleFeeType: 'DEDUCTED', saleFeeRate: 0.05, saleFeeRounding: 'ROUND', allowsWithdrawal: true, withdrawalFeeRate: 0.03, saleHoldDays: 3 },
  { name: 'Loja JPY', currency: 'JPY', saleFeeType: 'DEDUCTED', saleFeeRate: 0.06, saleFeeRounding: 'ROUND', allowsWithdrawal: false, saleHoldDays: 0 },
];
const EXTRA_FX_RATES = { EUR: 0.92, JPY: 150 };

// `components`: kind + item do catálogo (+ slot), resolvidos por nome no seed. `offSale`: item fora de venda (holding).
const CROWN = { name: 'Sticker | Crown (Foil)', category: 'STICKER' };
const EXTRA_STOCK_ITEMS = [
  // Armas com componentes (stickers, chaveiro, Sticker Slab).
  {
    catalog: { name: 'AK-47 | Asiimov', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.28, paintSeed: 322, store: 'CSFloat', priceCents: 4200, daysAgo: 9, inspectLink: INSPECT(5),
    components: [
      { kind: 'STICKER', catalog: CROWN, slot: 0 },
      { kind: 'STICKER', catalog: { name: 'Sticker | Natus Vincere (Holo) | MLG Columbus 2016', category: 'STICKER' }, slot: 1 },
      { kind: 'STICKER', catalog: { name: 'Sticker | Shooter', category: 'STICKER' }, slot: 2 },
      { kind: 'STICKER', catalog: CROWN, slot: 3 },
      { kind: 'CHARM', catalog: { name: "Charm | Lil' Teacup", category: 'PINGENTE' } },
    ],
  },
  {
    catalog: { name: 'M4A1-S | Printstream', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.07, paintSeed: 90, store: 'CSFloat', priceCents: 11500, daysAgo: 4,
    components: [{ kind: 'STICKER', catalog: CROWN, slot: 0 }, { kind: 'CHARM', catalog: { name: "Charm | Lil' SAS", category: 'PINGENTE' } }],
  },
  {
    catalog: { name: 'Desert Eagle | Blaze', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.02, paintSeed: 15, store: 'CSMoney', priceCents: 52000, daysAgo: 16,
    components: [{ kind: 'STICKER_SLAB', catalog: CROWN }],
  },
  { catalog: { name: 'MP9 | Bee-Tron', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.15, store: 'CSFloat', priceCents: 900, daysAgo: 18 },
  { catalog: { name: 'USP-S | Kill Confirmed', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.21, store: 'CSFloat', priceCents: 5400, daysAgo: 0, lockMs: 5 * DAY_MS },
  { catalog: { name: 'AK-47 | Redline', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.3, store: 'Loja EUR', priceCents: 3500, fxRateAtPurchase: 0.92, daysAgo: 13 },
  // Fora de venda (holding).
  { catalog: { name: 'M4A4 | Howl', category: 'SKIN' }, variant: 'STATTRAK', floatValue: 0.18, paintSeed: 207, store: 'CSFloat', priceCents: 250000, daysAgo: 60, offSale: true, inspectLink: INSPECT(6) },
  { catalog: { name: 'AWP | Dragon Lore', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.04, paintSeed: 611, store: 'CSFloat', priceCents: 450000, daysAgo: 120, offSale: true },
  { catalog: CROWN, store: 'CSFloat', priceCents: 3500, daysAgo: 90, offSale: true },
  // Grupos com várias unidades (visão agrupada): à venda, em trade lock e fora de venda no mesmo grupo.
  { catalog: CROWN, store: 'CSFloat', priceCents: 3200, daysAgo: 11 },
  { catalog: CROWN, store: 'CSFloat', priceCents: 3300, daysAgo: 2, lockMs: 4 * DAY_MS },
  // Caixas com chave (Fracture Case + 2 chaves) e sem chave (Dreams & Nightmares, Kilowatt).
  { catalog: { name: 'Fracture Case', category: 'CAIXA' }, store: 'Steam', priceCents: 280, fxRateAtPurchase: 5.3, daysAgo: 14 },
  { catalog: { name: 'Fracture Case', category: 'CAIXA' }, store: 'Steam', priceCents: 280, fxRateAtPurchase: 5.3, daysAgo: 14 },
  { catalog: { name: 'Fracture Case', category: 'CAIXA' }, store: 'Steam', priceCents: 260, fxRateAtPurchase: 5.25, daysAgo: 25 },
  { free: { name: 'Fracture Case Key', category: 'OUTRO' }, store: 'Steam', priceCents: 1200, fxRateAtPurchase: 5.3, daysAgo: 14 },
  { free: { name: 'Fracture Case Key', category: 'OUTRO' }, store: 'Steam', priceCents: 1200, fxRateAtPurchase: 5.3, daysAgo: 14 },
  { catalog: { name: 'Dreams & Nightmares Case', category: 'CAIXA' }, store: 'Steam', priceCents: 150, fxRateAtPurchase: 5.3, daysAgo: 5 },
  { catalog: { name: 'Dreams & Nightmares Case', category: 'CAIXA' }, store: 'Steam', priceCents: 140, fxRateAtPurchase: 5.2, daysAgo: 33 },
  { catalog: { name: 'Kilowatt Case', category: 'CAIXA' }, store: 'Steam', priceCents: 200, fxRateAtPurchase: 5.3, daysAgo: 6 },
  { catalog: { name: 'Kilowatt Case', category: 'CAIXA' }, store: 'Steam', priceCents: 190, fxRateAtPurchase: 5.3, daysAgo: 19 },
];

// Vendas: retidas (ainda dentro dos dias de liberação da loja) e liberadas, em USD, BRL, EUR e JPY.
const EXTRA_SOLD_ITEMS = [
  // Retidas.
  {
    item: { catalog: { name: 'USP-S | Kill Confirmed', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.12, store: 'CSFloat', priceCents: 6000, daysAgo: 14 },
    sale: { store: 'Loja EUR', priceCents: 8500, soldDaysAgo: 1 },
  },
  {
    item: { catalog: { name: 'MP9 | Bee-Tron', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.22, store: 'CSFloat', priceCents: 700, daysAgo: 10 },
    sale: { store: 'CSFloat', priceCents: 1100, soldDaysAgo: 3 },
  },
  // Liberadas.
  {
    item: { catalog: { name: 'AK-47 | Redline', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.3, store: 'CSFloat', priceCents: 3000, daysAgo: 40 },
    sale: { store: 'CSFloat', priceCents: 4500, soldDaysAgo: 20 },
  },
  {
    item: { catalog: { name: 'Fracture Case', category: 'CAIXA' }, store: 'Steam', priceCents: 250, fxRateAtPurchase: 5.2, daysAgo: 30 },
    sale: { store: 'Steam', priceCents: 420, soldDaysAgo: 10 },
  },
  {
    item: { catalog: { name: 'M4A1-S | Printstream', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.12, store: 'CSFloat', priceCents: 9000, daysAgo: 25 },
    sale: { store: 'Loja EUR', priceCents: 11800, soldDaysAgo: 8 },
  },
  {
    item: { catalog: { name: 'AWP | Asiimov', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.6, store: 'CSFloat', priceCents: 2300, daysAgo: 20 },
    sale: { store: 'Loja JPY', priceCents: 420000, soldDaysAgo: 6 },
  },
];

// Aportes (só em lojas USD), saques e conferências. `daysAgo` é contado a partir do `now` do seed.
const EXTRA_DEPOSITS = [
  { store: 'CSFloat', amountStoreCents: 500000, feeCents: 0, amountBrlCents: 2600000, daysAgo: 130, note: 'Primeiro aporte' },
  { store: 'CSFloat', amountStoreCents: 350000, feeCents: 5000, amountBrlCents: 1850000, daysAgo: 95 },
  { store: 'CSFloat', amountStoreCents: 150000, feeCents: 0, amountBrlCents: null, daysAgo: 50 },
  { store: 'CSMoney', amountStoreCents: 200000, feeCents: 0, amountBrlCents: 1050000, daysAgo: 90 },
];
const EXTRA_WITHDRAWALS = [
  { store: 'CSFloat', amountStoreCents: 15000, feeCents: 375, amountBrlCents: 79000, daysAgo: 30, note: 'Saque para a conta' },
  { store: 'CSMoney', amountStoreCents: 8000, feeCents: null, amountBrlCents: null, daysAgo: 12 },
];
// Steam (BRL) não recebe aporte em dólar: o saldo entra por uma conferência com ajuste. A do CSFloat bate com o calculado.
const EXTRA_BALANCE_CHECKS = [
  { store: 'Steam', balanceCents: 8500, adjust: true, note: 'Saldo da carteira conferido no cliente', daysAgo: 3 },
  { store: 'CSFloat', adjust: false, daysAgo: 6 }, // balanceCents = o calculado (sem diferença)
];

// Importação do CSFloat com pendências "para conferir" (registros fictícios, sem dados da conta).
const EXTRA_IMPORT = {
  daysAgo: 1,
  entries: [
    {
      outcome: 'POSSIBLE_DUPLICATE', reasonCode: 'POSSIBLE_DUPLICATE', externalId: 'demo-trade-1001', direction: 'BUY', amountCents: 4200,
      display: { direction: 'BUY', catalog: { name: 'AK-47 | Asiimov', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.28, priceCents: 4200, state: 'ACCEPTED' },
    },
    {
      outcome: 'FAILED', reasonCode: 'PURCHASE_NOT_FOUND', externalId: 'demo-trade-1002', direction: 'SELL', amountCents: 2600,
      display: { direction: 'SELL', catalog: { name: 'AWP | Asiimov', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.41, priceCents: 2600, state: 'ACCEPTED' },
    },
    {
      outcome: 'REVERTED', reasonCode: 'TRADE_REVERTED', externalId: 'demo-trade-1003', direction: 'SELL', amountCents: 1100,
      display: { direction: 'SELL', catalog: { name: 'MP9 | Bee-Tron', category: 'SKIN' }, variant: 'NORMAL', floatValue: 0.22, priceCents: 1100, state: 'REVERTED' },
    },
  ],
};

module.exports = {
  DAY_MS, HOUR_MS, STOCK_ITEMS, SOLD_ITEMS, acquiredAtFor, inFuture, DEV_FX_RATE: 5.4,
  EXTRA_STORES, EXTRA_FX_RATES, EXTRA_STOCK_ITEMS, EXTRA_SOLD_ITEMS, EXTRA_DEPOSITS, EXTRA_WITHDRAWALS, EXTRA_BALANCE_CHECKS, EXTRA_IMPORT,
};
