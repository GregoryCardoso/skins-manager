'use strict';

// Orquestra a atualização dos preços de mercado e o resumo (D364 item 6). Só aqui a rede é chamada, e só pela rodada de abertura do app
// (`POST /api/market-values/refresh`): sem botão e sem escopo "todos". Preços do cache: nunca entram no lucro real, nos saldos, no
// itemStats nem no preço mínimo (2.13).
const {
  MARKET_PRICE_STALE_HOURS, VALUATION_CALL_DELAY_MS, VALUATION_FALLBACK_MAX_KEYS, VALUATION_TOTAL_TIMEOUT_MS, VALUATION_RATE_LIMIT_RESERVE,
  VALUATION_COOLDOWN_MS,
} = require('../../config/constants');
const { UpstreamError } = require('../../errors/AppError');
const Item = require('../../models/Item');
const ItemComponent = require('../../models/ItemComponent');
const MarketPrice = require('../../models/MarketPrice');
const Setting = require('../../models/Setting');
const integrationService = require('../integrationService');
const catalogService = require('../catalogService');
const backupService = require('../backupService');
const importLock = require('../imports/importLock');
const operationContext = require('../operations/operationContext');
const { isOffSale } = require('../inventoryAgingService');
const { approxOf, fxFromSettings, displayCurrencyOf } = require('../currencyService');
const valuationLock = require('./valuationLock');
const valuationService = require('./valuationService');
const valuationIndex = require('./valuationIndex');
const { buildPriceTarget } = require('./marketHashName');
const { getSource, ACTIVE_VALUATION_SOURCE } = require('./valuationSources');

const STALE_MS = MARKET_PRICE_STALE_HOURS * 3600000;
const isNil = (v) => v === null || v === undefined;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Chaves distintas a buscar, com prioridade: 1) itens em estoque, 2) pendurados, 3) stickers e patches. Dez unidades iguais = uma chave.
// Devolve { targets: [{ marketHashName, paintIndex, priceKey, level }], notPriceableUnits }.
function collectTargets({ items, componentsByItemId = new Map(), catalogById = new Map() }) {
  const byKey = new Map();
  let notPriceableUnits = 0;
  const add = (target, level) => {
    const current = byKey.get(target.priceKey);
    if (!current) byKey.set(target.priceKey, { ...target, level });
    else if (level < current.level) current.level = level;
  };
  for (const item of items) {
    if (item.status !== 'EM_ESTOQUE') continue;
    const target = buildPriceTarget(item, { catalogById });
    if (target.notPriceable) notPriceableUnits += 1;
    else add(target, 1);
    for (const component of componentsByItemId.get(item.id) ?? []) {
      const found = buildPriceTarget(component, { catalogById });
      if (found.notPriceable) continue;
      add(found, component.kind === 'CHARM' || component.kind === 'STICKER_SLAB' ? 2 : 3);
    }
  }
  return { targets: [...byKey.values()], notPriceableUnits };
}

// Só as chaves desatualizadas (nunca buscadas, ou última tentativa há mais de 24 h), por nível e, dentro dele, as nunca buscadas primeiro
// e depois a `fetchedAt` mais antiga.
function pickStale(targets, rowsByKey, now) {
  const stale = targets.filter((t) => {
    const row = rowsByKey.get(t.priceKey);
    return !row || now.getTime() - Date.parse(row.fetchedAt) > STALE_MS;
  });
  const fetchedMs = (t) => {
    const row = rowsByKey.get(t.priceKey);
    return row ? Date.parse(row.fetchedAt) : -Infinity;
  };
  return stale.sort((a, b) => a.level - b.level || (fetchedMs(a) === fetchedMs(b) ? 0 : fetchedMs(a) < fetchedMs(b) ? -1 : 1) || (a.priceKey < b.priceKey ? -1 : 1));
}

function nextAllowedAtOf(lastRefreshAt) {
  if (isNil(lastRefreshAt)) return null;
  return new Date(Date.parse(lastRefreshAt) + VALUATION_COOLDOWN_MS).toISOString();
}

// Próximo instante permitido, ou null se já pode rodar agora.
function cooldownUntil(lastRefreshAt, now) {
  const next = nextAllowedAtOf(lastRefreshAt);
  return next !== null && now.getTime() < Date.parse(next) ? next : null;
}

function loadStock() {
  const items = Item.findAll({ status: 'EM_ESTOQUE' });
  const componentsByItemId = ItemComponent.listAll();
  const ids = new Set(items.map((i) => i.catalogId).filter((id) => !isNil(id)));
  for (const rows of componentsByItemId.values()) for (const row of rows) if (!isNil(row.catalogId)) ids.add(row.catalogId);
  const catalogById = new Map(catalogService.getCatalogItemsByIds([...ids]).map((c) => [c.id, c]));
  return { items, componentsByItemId, catalogById };
}

// A rodada já foi tentada neste processo (uma por execução do app, como o `autoAttempted` da importação).
let attempted = false;
const resetAttemptForTests = () => {
  attempted = false;
};

const buildResult = (extra = {}) => ({
  requested: 0, fetched: 0, updated: 0, notFound: 0, notPriceableUnits: 0, remaining: 0, budgetUsed: 0, stoppedBy: null, retryAt: null,
  lastRefreshAt: null, ...extra,
});
const skip = (reason) => ({ skipped: reason, result: null, failed: null });

// Rodada de atualização ao abrir o app (D364, Adendo 1): só os desatualizados (nunca buscados ou há mais de 24 h). Sempre devolve
// `{ skipped, result, failed }`; nada sobe como erro (as falhas são silenciosas e ficam em `settings`).
// Pré-condições, nesta ordem e antes de qualquer rede: ALREADY_RAN, NOT_CONFIGURED (sem chave), BUSY (atualização, importação ou exportação
// de backup em andamento; não consome a tentativa) e COOLDOWN (início da última rodada há menos de 15 min).
// Em série, 1 s entre chamadas: a 1.ª sempre sai; depois só enquanto `remaining` > reserva (sem headers, no máximo 50 chaves) e dentro do
// prazo total. Cada preço é gravado ao chegar.
async function refreshPrices({ now = new Date(), fetchFn, nowFn = Date.now, sleepFn = defaultSleep, source = ACTIVE_VALUATION_SOURCE } = {}) {
  const valuationSource = getSource(source);
  if (attempted) return skip('ALREADY_RAN');
  const apiKey = integrationService.getApiKeyForCall(valuationSource.adapterSource);
  if (!apiKey) return skip('NOT_CONFIGURED');
  if (valuationLock.isValuationInProgress() || importLock.isImportInProgress() || backupService.isExportInProgress()) return skip('BUSY');
  const state = Setting.getPriceRefresh();
  if (cooldownUntil(state.priceRefreshStartedAt, now)) return skip('COOLDOWN');
  attempted = true;
  // Rodada inteira protegida (M3): qualquer erro que não seja do CSFloat vira FAILED/INTERNAL_ERROR e a resposta continua 200. A trava
  // é liberada no `finally` da própria rodada.
  try {
    return await runRound({ now, fetchFn, nowFn, sleepFn, source, valuationSource, apiKey });
  } catch (err) {
    console.error(`Falha interna na atualização dos preços de mercado: ${err && err.message ? err.message : 'erro desconhecido'}`);
    try {
      Setting.updatePriceRefresh({ priceRefreshLastAt: now.toISOString(), priceRefreshLastStatus: 'FAILED', priceRefreshLastErrorCode: 'INTERNAL_ERROR' });
    } catch (inner) {
      console.error('Não foi possível gravar o estado da atualização dos preços.');
    }
    return { skipped: null, result: null, failed: { code: 'INTERNAL_ERROR' } };
  }
}

async function runRound({ now, fetchFn, nowFn, sleepFn, source, valuationSource, apiKey }) {
  const stock = loadStock();
  const { targets, notPriceableUnits } = collectTargets(stock);
  const rowsByKey = MarketPrice.findByKeys(source, targets.map((t) => t.priceKey));
  const queue = pickStale(targets, rowsByKey, now);
  const result = buildResult({ requested: queue.length, notPriceableUnits });
  const stamp = now.toISOString();
  if (queue.length === 0) {
    Setting.updatePriceRefresh({ priceRefreshLastAt: stamp, priceRefreshLastStatus: 'OK', priceRefreshLastErrorCode: null });
    return { skipped: null, result: { ...result, lastRefreshAt: MarketPrice.maxPricedAt(source) }, failed: null };
  }

  const release = valuationLock.acquire();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VALUATION_TOTAL_TIMEOUT_MS);
  const deadlineAt = nowFn() + VALUATION_TOTAL_TIMEOUT_MS;
  let errorCode = null;
  try {
    Setting.updatePriceRefresh({ priceRefreshStartedAt: stamp }); // antes da 1.ª chamada: a rodada interrompida também conta
    for (let i = 0; i < queue.length; i += 1) {
      if (i > 0) {
        await sleepFn(VALUATION_CALL_DELAY_MS, controller.signal);
        if (nowFn() >= deadlineAt) { result.stoppedBy = 'VALUATION_DEADLINE'; break; }
      }
      const target = queue[i];
      let found;
      try {
        found = await valuationSource.fetchReference({
          marketHashName: target.marketHashName, paintIndex: target.paintIndex, apiKey, fetchFn, totalSignal: controller.signal,
          totalDeadlineAt: deadlineAt, nowFn, sleepFn,
        });
      } catch (err) {
        if (!(err instanceof UpstreamError)) throw err;
        errorCode = err.code;
        result.stoppedBy = err.code;
        if (err.params && err.params.retryAt) result.retryAt = err.params.retryAt;
        break;
      }
      MarketPrice.upsertResult({
        source, priceKey: target.priceKey, marketHashName: target.marketHashName, paintIndex: target.paintIndex, status: found.status,
        basePriceCents: found.basePriceCents, referenceQuantity: found.referenceQuantity, sourceUpdatedAt: found.sourceUpdatedAt,
      }, now);
      result.fetched += 1;
      if (found.status === 'OK') result.updated += 1;
      else result.notFound += 1;
      if (i + 1 >= queue.length) break;
      const rate = found.rateLimit;
      const remaining = rate ? rate.remaining : null;
      if (remaining !== null && remaining <= VALUATION_RATE_LIMIT_RESERVE) {
        result.stoppedBy = 'IMPORT_RATE_LIMITED';
        result.retryAt = rate.resetAt ?? null;
        break;
      }
      if (remaining === null && result.fetched >= VALUATION_FALLBACK_MAX_KEYS) {
        result.stoppedBy = 'VALUATION_FALLBACK_LIMIT';
        break;
      }
    }
  } finally {
    clearTimeout(timer);
    release();
  }
  result.budgetUsed = result.fetched;
  result.remaining = queue.length - result.fetched;
  const failedAll = errorCode !== null && result.fetched === 0;
  const status = failedAll ? 'FAILED' : result.stoppedBy ? 'PARTIAL' : 'OK';
  Setting.updatePriceRefresh({ priceRefreshLastAt: stamp, priceRefreshLastStatus: status, priceRefreshLastErrorCode: errorCode });
  result.lastRefreshAt = MarketPrice.maxPricedAt(source);
  return { skipped: null, result, failed: failedAll ? { code: errorCode } : null };
}

// Totais do estoque atual (à venda, incluindo trade lock, e fora de venda) e o estado do cache. Nada é gravado.
function getSummary({ now = new Date(), source = ACTIVE_VALUATION_SOURCE } = {}) {
  const valuationSource = getSource(source);
  const fx = fxFromSettings(Setting.get());
  const stock = loadStock();
  const costIndex = operationContext.loadCostIndex(stock.items);
  const index = valuationIndex.buildValuationIndex({ ...stock, costIndex, fx, now });
  const totalsOf = (units) => {
    const totals = valuationService.summarize(units.map((u) => index.get(u.id)).filter(Boolean));
    return {
      ...totals,
      approxCurrency: displayCurrencyOf(fx),
      approx: {
        marketValue: approxOf(totals.marketValueUsdCents, fx),
        unrealized: approxOf(totals.unrealizedUsdCents, fx),
        unrealizedNet: approxOf(totals.unrealizedNetUsdCents, fx),
      },
    };
  };
  const rows = MarketPrice.listBySource(source);
  const pricedAts = rows.filter((r) => !isNil(r.pricedAt)).map((r) => Date.parse(r.pricedAt));
  const { targets } = collectTargets(stock);
  const rowsByKey = new Map(rows.map((r) => [r.priceKey, r]));
  const state = Setting.getPriceRefresh();
  return {
    configured: Boolean(integrationService.getApiKeyForCall(valuationSource.adapterSource)),
    inProgress: valuationLock.isValuationInProgress(),
    source,
    staleHours: MARKET_PRICE_STALE_HOURS,
    lastRefreshAt: MarketPrice.maxPricedAt(source),
    lastRun: state.priceRefreshLastAt
      ? { at: state.priceRefreshLastAt, status: state.priceRefreshLastStatus, errorCode: state.priceRefreshLastErrorCode }
      : null,
    nextAllowedAt: cooldownUntil(state.priceRefreshStartedAt, now),
    oldestPricedAt: pricedAts.length ? new Date(Math.min(...pricedAts)).toISOString() : null,
    staleKeys: pickStale(targets, rowsByKey, now).length,
    isEstimated: true,
    totals: totalsOf(stock.items),
    byState: {
      forSale: totalsOf(stock.items.filter((i) => !isOffSale(i))),
      holding: totalsOf(stock.items.filter((i) => isOffSale(i))),
    },
  };
}

module.exports = { collectTargets, pickStale, refreshPrices, getSummary, cooldownUntil, resetAttemptForTests };
