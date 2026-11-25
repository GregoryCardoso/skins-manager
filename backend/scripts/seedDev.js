'use strict';

// Cria/recria o banco de exemplo backend/data/inventory.dev.sqlite com itens fictícios (D108).
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
  if (def.lockMs) input.tradeUnlockAt = data.inFuture(now, def.lockMs).toISOString();
  if (def.unlockAfterDays) {
    input.tradeUnlockAt = new Date(data.acquiredAtFor(now, def.daysAgo).getTime() + def.unlockAfterDays * data.DAY_MS).toISOString();
  }
  return input;
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
  const settingsService = require('../src/services/settingsService');
  const Store = require('../src/models/Store');
  const CatalogItem = require('../src/models/CatalogItem');
  const { normalizeSearchText } = require('../src/services/catalog/csgoApiAdapter');

  const sync = catalogService.syncBundledCatalog({ now });
  if (sync.error) throw fail(`Não foi possível importar o catálogo embutido: ${sync.error.message}`);
  settingsService.updateFxRate(data.DEV_FX_RATE, { now });
  settingsService.updatePreferences({ displayCurrency: 'BRL', steamStore: 'FOLLOW' }, { now }); // os dados de exemplo são em R$ (como os bancos existentes), com a Steam em R$

  const ctx = { now, stores: Store.findAll(), deps: { CatalogItem, normalizeSearchText } };
  const created = [];
  for (const def of data.STOCK_ITEMS) {
    created.push(itemService.createItem(buildItemInput(def, ctx), { now }));
  }
  let sold = 0;
  for (const { item, sale } of data.SOLD_ITEMS) {
    const view = itemService.createItem(buildItemInput(item, ctx), { now });
    itemService.sellItem(view.id, {
      saleStoreId: storeIdByName(ctx.stores, sale.store),
      salePriceCents: sale.priceCents,
      soldAt: new Date(now.getTime() - sale.soldDaysAgo * data.DAY_MS).toISOString(),
    }, { now });
    sold += 1;
  }
  return { inStock: created.length, sold, total: created.length + sold, catalogImported: sync.imported, dbPath: env.dbPath };
}

function main() {
  const target = devDb.resolveSeedTarget({ argv: process.argv.slice(2) }); // recusa o banco real antes de tudo
  process.env.DB_PATH = target; // antes de carregar qualquer módulo de src/ (dotenv não sobrescreve)
  const result = runDevSeed({});
  const { closeDb } = require('../src/config/database');
  closeDb();
  console.log(`Banco de exemplo criado em ${result.dbPath}`);
  console.log(`${result.total} itens (${result.inStock} em estoque, ${result.sold} vendidos). Cotação USD→BRL de exemplo: ${data.DEV_FX_RATE}.`);
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
