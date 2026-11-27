'use strict';

// Faixa de posição do inventário (D370, 12.5b) e busca pelo nome. Funções puras, sem banco; o itemService só entrega os dados.
// Nenhuma regra nova: o custo é o mesmo do estoque do lucro real (custo efetivo e cotação gravada na compra, 8.9), e "encalhado" é o
// de sempre (à venda, liberado e acima do limite; holding e trade lock nunca entram, 2.6 e 2.6.1).
const { approxOf, displayCurrencyOf } = require('./currencyService');
const { splitStockUsd } = require('./profitService');
const { filterStagnant } = require('./inventoryAgingService');
const { buildStatsKey } = require('./itemStatsService');
const { summarizeStockStates } = require('./inventoryGroupService');
const { normalizeSearchText } = require('./catalog/csgoApiAdapter');
const { EMPTY_COST_INDEX } = require('./operations/costService');

// Texto de busca: sem acento, sem caixa e sem ★ ™ ®; o "ı" turco (sem ponto) vira "i" nos dois lados da comparação.
function normalizeInventorySearch(text) {
  // ß vira ss ("grosse" acha "Größe"), como o ı turco vira i.
  return normalizeSearchText(text).replace(/ı/g, 'i').replace(/ß/g, 'ss');
}

// "Contém" sobre o nome canônico e o nome no idioma das configurações (`localizedName` do catálogo, quando houver).
function matchesInventorySearch(item, localizedName, needle) {
  if (!needle) return true;
  if (normalizeInventorySearch(item.name).includes(needle)) return true;
  return typeof localizedName === 'string' && localizedName !== '' && normalizeInventorySearch(localizedName).includes(needle);
}

// `all`: todos os itens (qualquer status); só os em estoque entram. Independe de filtros e abas.
function buildPosition(all, { costIndex = EMPTY_COST_INDEX, fx = null, thresholds, now = new Date() } = {}) {
  const stock = all.filter((item) => item.status === 'EM_ESTOQUE');
  const split = splitStockUsd(stock, { costIndex });
  const display = displayCurrencyOf(fx);
  const part = (side) => {
    const approx = side.totalUsdCents === null ? null : approxOf(side.totalUsdCents, fx);
    return {
      costUsdCents: side.totalUsdCents,
      costUsesRecordedFx: side.estimated,
      approx: approx === null ? null : { currency: display, cents: approx },
    };
  };
  const states = summarizeStockStates(stock, now);
  const stagnantUnits = filterStagnant(stock, thresholds, now);
  return {
    forSale: part(split.forSale),
    offSale: part(split.offSale),
    tradeLocked: { units: states.tradeLocked, nextUnlockAt: states.nextUnlockAt },
    stagnant: { units: stagnantUnits.length, groups: new Set(stagnantUnits.map(buildStatsKey)).size },
  };
}

module.exports = { normalizeInventorySearch, matchesInventorySearch, buildPosition };
