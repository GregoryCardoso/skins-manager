'use strict';

// Cria/recria o banco de exemplo backend/data/inventory.dev.sqlite com dados fictícios (D108; ampliado na 12.11): itens em todas as faixas de
// giro, trade lock, fora de venda, componentes, caixas com/sem chave, vendas retidas e liberadas, lojas USD/BRL/EUR/JPY, aportes, saques,
// conferência com ajuste e uma importação com pendências "para conferir". Também serve ao `npm run dev:demo`.
//   npm run seed:dev   (dentro de backend/ ou na raiz)
// NUNCA abre o banco real. O DB_PATH é definido aqui, antes de carregar qualquer módulo de src/.
const path = require('path');
const devDb = require('./devDb');
const data = require('./devSeedData');

function fail(message) {
  return new Error(message);
}

function storeIdByName(stores, name) {
  const store = stores.find((s) => s.name === name);
  if (!store) throw fail(`Loja "${name}" não encontrada no banco de exemplo.`);
  return store.id;
}

// Resolve o `catalogId` por nome canônico + categoria (+ fase). Nome ausente ou ambíguo → erro claro.
function resolveCatalogId({ name, category, phase }, { CatalogItem, normalizeSearchText }) {
  let matches = CatalogItem.findByNameKey(normalizeSearchText(name), category);
  if (phase) matches = matches.filter((m) => m.phase === phase);
  if (matches.length === 0) {
    throw fail(`Item "${name}" (${category}${phase ? `, ${phase}` : ''}) não existe no catálogo embutido. Rode "npm run catalog:snapshot" ou ajuste scripts/devSeedData.js.`);
  }
  if (matches.length > 1) throw fail(`Item "${name}" (${category}) é ambíguo no catálogo (${matches.length} entradas); informe a fase.`);
  return matches[0].id;
}

function buildItemInput(def, ctx) {
  const { now, stores, deps } = ctx;
  const input = { acquiredAt: data.acquiredAtFor(now, def.daysAgo).toISOString() };
  if (def.catalog) input.catalogId = resolveCatalogId(def.catalog, deps);
  else Object.assign(input, { name: def.free.name, category: def.free.category });
  for (const key of ['variant', 'floatValue', 'paintSeed', 'inspectLink', 'originDetail']) {
    if (def[key] !== undefined) input[key] = def[key];
  }
  if (def.ganhei) {
    input.acquisitionType = 'GANHEI';
  } else {
    input.acquisitionType = 'COMPRA';
    input.purchaseStoreId = storeIdByName(stores, def.store);
    input.purchasePriceCents = def.priceCents;
    if (def.fxRateAtPurchase !== undefined) input.fxRateAtPurchase = def.fxRateAtPurchase;
  }
  if (def.components) {
    input.components = def.components.map(({ kind, catalog, slot }) => ({
      kind, catalogId: resolveCatalogId(catalog, deps), ...(slot !== undefined ? { slot } : {}),
    }));
  }
  if (def.lockMs) input.tradeUnlockAt = data.inFuture(now, def.lockMs).toISOString();
  if (def.unlockAfterDays) {
    input.tradeUnlockAt = new Date(data.acquiredAtFor(now, def.daysAgo).getTime() + def.unlockAfterDays * data.DAY_MS).toISOString();
  }
  return input;
}

// Lote de importação do CSFloat já concluído, com pendências "para conferir" (D318). Grava direto nos models: não chama o CSFloat.
function seedImport(def, { now, deps }) {
  const ImportBatch = require('../src/models/ImportBatch');
  const ImportBatchEntry = require('../src/models/ImportBatchEntry');
  const ExternalRecord = require('../src/models/ExternalRecord');
  const at = new Date(now.getTime() - def.daysAgo * data.DAY_MS).toISOString();
  const batch = ImportBatch.create({
    source: 'CSFLOAT', trigger: 'MANUAL', status: 'DONE', startedAt: at, finishedAt: at, fullScan: false, reviewCount: def.entries.length,
  }, { now });
  for (const entry of def.entries) {
    const catalogId = resolveCatalogId(entry.display.catalog, deps);
    const { catalog, ...rest } = entry.display;
    const record = ExternalRecord.create({
      source: 'CSFLOAT', kind: 'TRADE', externalId: entry.externalId, direction: entry.direction, tracking: 'NEEDS_REVIEW',
      externalCreatedAt: at, amountCents: entry.amountCents, displayName: catalog.name, firstBatchId: batch.id, lastBatchId: batch.id, lastSeenAt: at,
    }, { now });
    ImportBatchEntry.create({
      batchId: batch.id, recordId: record.id, outcome: entry.outcome, reasonCode: entry.reasonCode,
      displayJson: JSON.stringify({ ...rest, marketHashName: catalog.name, catalogId, category: catalog.category, currency: 'USD', date: at }),
    }, { now });
  }
  return def.entries.length;
}

// Preços fictícios de valor de mercado (E13-Q1): grava direto no cache `market_prices`, sem rede e sem chave da API. Cada item em estoque e
// cada componente precisa ter preço em `data.MARKET_PRICES` (chave = `priceKey`, "nome de mercado|paint_index"); faltando, o seed falha
// listando as chaves, para o exemplo nunca ficar com buracos sem querer.
function seedMarketPrices({ now }) {
  const Item = require('../src/models/Item');
  const ItemComponent = require('../src/models/ItemComponent');
  const MarketPrice = require('../src/models/MarketPrice');
  const catalogService = require('../src/services/catalogService');
  const { collectTargets } = require('../src/services/valuation/marketValueService');
  const { ACTIVE_VALUATION_SOURCE } = require('../src/services/valuation/valuationSources');
  const items = Item.findAll({ status: 'EM_ESTOQUE' });
  const componentsByItemId = ItemComponent.listAll();
  const isSet = (v) => v !== null && v !== undefined;
  const ids = new Set(items.map((i) => i.catalogId).filter(isSet));
  for (const rows of componentsByItemId.values()) for (const row of rows) if (isSet(row.catalogId)) ids.add(row.catalogId);
  const catalogById = new Map(catalogService.getCatalogItemsByIds([...ids]).map((c) => [c.id, c]));
  const { targets } = collectTargets({ items, componentsByItemId, catalogById });
  const missing = targets.filter((t) => data.MARKET_PRICES[t.priceKey] === undefined).map((t) => t.priceKey);
  if (missing.length > 0) throw fail(`Faltam preços de exemplo em MARKET_PRICES (scripts/devSeedData.js) para: ${missing.join(' ; ')}`);
  for (const t of targets) {
    MarketPrice.upsertResult({
      source: ACTIVE_VALUATION_SOURCE, priceKey: t.priceKey, marketHashName: t.marketHashName, paintIndex: t.paintIndex, status: 'OK',
      basePriceCents: data.MARKET_PRICES[t.priceKey], referenceQuantity: 25, sourceUpdatedAt: now.toISOString(),
    }, now);
  }
  return targets.length;
}

// Recria o conteúdo do banco já configurado no app (env.dbPath). Usa os services: todas as regras de negócio valem.
// `allowMemory` só é aceito em testes (NODE_ENV === 'test').
function runDevSeed({ now = new Date(), allowMemory = false, realDbPaths = devDb.resolveRealDbPaths({ env: {} }) } = {}) {
  const env = require('../src/config/env');
  const memoryOk = allowMemory && process.env.NODE_ENV === 'test';
  devDb.assertSafeTarget(env.dbPath, { allowMemory: memoryOk, realDbPaths });

  const { getDb, closeDb } = require('../src/config/database');
  if (env.dbPath !== ':memory:') {
    closeDb();
    devDb.removeDbFiles(env.dbPath);
  }
  getDb(); // migrações + seed das lojas

  const catalogService = require('../src/services/catalogService');
  const itemService = require('../src/services/itemService');
  const storeService = require('../src/services/storeService');
  const depositService = require('../src/services/depositService');
  const withdrawalService = require('../src/services/withdrawalService');
  const storeBalanceService = require('../src/services/storeBalanceService');
  const settingsService = require('../src/services/settingsService');
  const Store = require('../src/models/Store');
  const CatalogItem = require('../src/models/CatalogItem');
  const { normalizeSearchText } = require('../src/services/catalog/csgoApiAdapter');

  const sync = catalogService.syncBundledCatalog({ now });
  if (sync.error) throw fail(`Não foi possível importar o catálogo embutido: ${sync.error.message}`);
  settingsService.updateFxRate(data.DEV_FX_RATE, { now });
  settingsService.updatePreferences({ displayCurrency: 'BRL', steamStore: 'FOLLOW' }, { now }); // os dados de exemplo são em R$ (como os bancos existentes), com a Steam em R$

  // Lojas extras (EUR e JPY) e cotações de exemplo, antes dos itens.
  for (const store of data.EXTRA_STORES) storeService.createStore(store, { now });
  for (const [currency, rate] of Object.entries(data.EXTRA_FX_RATES)) settingsService.setFxRate(currency, rate, { now });

  // Numa instalação nova só a CSFloat vende; o exemplo vende também na Steam e na CSMoney, então liga "Vendo nesta loja" nelas.
  for (const store of Store.findAll()) if (!store.sellsHere) Store.update(store.id, { sellsHere: true }, { now });

  const ctx = { now, stores: Store.findAll(), deps: { CatalogItem, normalizeSearchText } };
  const createStock = (def) => {
    const view = itemService.createItem(buildItemInput(def, ctx), { now });
    if (def.offSale) itemService.markOffSale(view.id, { now });
    return view;
  };
  const sell = (def) => {
    const view = itemService.createItem(buildItemInput(def.item, ctx), { now });
    itemService.sellItem(view.id, {
      saleStoreId: storeIdByName(ctx.stores, def.sale.store),
      salePriceCents: def.sale.priceCents,
      soldAt: new Date(now.getTime() - def.sale.soldDaysAgo * data.DAY_MS).toISOString(),
    }, { now });
  };
  const created = [];
  for (const def of [...data.STOCK_ITEMS, ...data.EXTRA_STOCK_ITEMS]) created.push(createStock(def));
  let sold = 0;
  for (const def of [...data.SOLD_ITEMS, ...data.EXTRA_SOLD_ITEMS]) {
    sell(def);
    sold += 1;
  }

  const daysBefore = (days) => new Date(now.getTime() - days * data.DAY_MS).toISOString();
  for (const d of data.EXTRA_DEPOSITS) {
    depositService.createDeposit({
      storeId: storeIdByName(ctx.stores, d.store), amountStoreCents: d.amountStoreCents, feeCents: d.feeCents, amountBrlCents: d.amountBrlCents,
      depositedAt: daysBefore(d.daysAgo), ...(d.note ? { note: d.note } : {}),
    }, { now });
  }
  for (const w of data.EXTRA_WITHDRAWALS) {
    withdrawalService.createWithdrawal({
      storeId: storeIdByName(ctx.stores, w.store), amountStoreCents: w.amountStoreCents, feeCents: w.feeCents, amountBrlCents: w.amountBrlCents,
      withdrawnAt: daysBefore(w.daysAgo), ...(w.note ? { note: w.note } : {}),
    }, { now });
  }
  // Conferências em ordem de data (a mais antiga primeiro). Sem `balanceCents`, usa o saldo calculado (sem diferença).
  for (const c of [...data.EXTRA_BALANCE_CHECKS].sort((a, b) => b.daysAgo - a.daysAgo)) {
    const storeId = storeIdByName(ctx.stores, c.store);
    const recordedAt = daysBefore(c.daysAgo);
    const balanceCents = c.balanceCents !== undefined
      ? c.balanceCents
      : storeBalanceService.previewCheck({ storeId, recordedAt, balanceCents: 0 }, { now }).computedCents;
    storeBalanceService.createCheck({ storeId, recordedAt, balanceCents, adjust: c.adjust, ...(c.note ? { note: c.note } : {}) }, { now });
  }
  const importedPending = seedImport(data.EXTRA_IMPORT, { now, deps: ctx.deps });
  const marketPrices = seedMarketPrices({ now });

  return { inStock: created.length, sold, total: created.length + sold, importPending: importedPending, marketPrices, catalogImported: sync.imported, dbPath: env.dbPath };
}

function main() {
  const target = devDb.resolveSeedTarget({ argv: process.argv.slice(2) }); // recusa o banco real antes de tudo
  process.env.DB_PATH = target; // antes de carregar qualquer módulo de src/ (dotenv não sobrescreve)
  const result = runDevSeed({});
  const { closeDb } = require('../src/config/database');
  closeDb();
  console.log(`Banco de exemplo criado em ${result.dbPath}`);
  console.log(`${result.total} itens (${result.inStock} em estoque, ${result.sold} vendidos), ${result.importPending} pendências de importação. Cotação USD→BRL de exemplo: ${data.DEV_FX_RATE}.`);
  console.log('Para usar: npm run dev:backend:demo  (no PowerShell: npm.cmd run dev:backend:demo)');
  console.log(`O banco real (${path.join('backend', 'data', 'inventory.sqlite')}) não foi aberto nem alterado.`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`Falha no seed:dev: ${err && err.message ? err.message : err}`);
    process.exit(1);
  }
}

module.exports = { runDevSeed, buildItemInput, resolveCatalogId };
