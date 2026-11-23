'use strict';

// Trade -> item do catálogo e atributos do app (D297, D318 seção 6). Funções puras: o acesso ao catálogo é injetado
// (`findByNameKeyAnyCategory`), então os testes não precisam de banco.
const { normalizeSearchText } = require('../catalog/csgoApiAdapter');
const { isWeaponCategory } = require('../itemAttributesService');
const { DOPPLER_PHASES } = require('./adapters/csfloatStates');
const { IMPORT_DEFAULT_TRADE_LOCK_DAYS } = require('../../config/constants');

const EXTERIOR_SUFFIX = /\s+\((?:Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/;
// Itens sem equivalente no catálogo que entram como OUTRO (E9-Q8): patch, grafite, music kit e chave de caixa.
const FREE_NAME_PREFIXES = Object.freeze(['Patch |', 'Sealed Graffiti |', 'Graffiti |', 'Music Kit |', 'StatTrak™ Music Kit |']);
const FREE_NAME_SUFFIX = / Key$/;

// Nome do catálogo a procurar: sem ★, sem "StatTrak™ " (se for StatTrak), sem "Souvenir " (se for Souvenir; assim não estraga
// "Souvenir Package") e sem o sufixo de desgaste. Devolve o texto já normalizado (name_key).
function baseNameKey(item) {
  let name = item.marketHashName.trim().replace(/^★\s*/, '');
  if (item.isStattrak) name = name.replace(/^StatTrak™\s+/, '');
  if (item.isSouvenir) name = name.replace(/^Souvenir\s+/, '');
  name = name.replace(EXTERIOR_SUFFIX, '');
  return normalizeSearchText(name);
}

function variantOf(item) {
  if (item.isStattrak) return 'STATTRAK';
  if (item.isSouvenir) return 'SOUVENIR';
  return 'NORMAL';
}

// Fase da Doppler/Gamma Doppler: o texto `phase` do CSFloat; sem ele, a tabela fixa por `paint_index`. Normalizada, ou null.
function tradePhaseKey(item) {
  const text = item.phase || (item.paintIndex !== null && item.paintIndex !== undefined ? DOPPLER_PHASES[item.paintIndex] : null);
  return text ? normalizeSearchText(text) : null;
}

function isFreeNameItem(marketHashName) {
  return FREE_NAME_PREFIXES.some((prefix) => marketHashName.startsWith(prefix)) || FREE_NAME_SUFFIX.test(marketHashName);
}

// Entre os candidatos do catálogo escolhe um: nenhum -> NOT_FOUND; um -> ele; vários -> desempata pela fase; entradas idênticas
// (as facas duplicadas, D115) ficam com a de menor id; o resto é ambíguo.
function pickCandidate(candidates, phaseKey) {
  if (candidates.length === 0) return { kind: 'NOT_FOUND' };
  const hasPhases = candidates.some((c) => c.phase !== null && c.phase !== undefined);
  let pool = candidates;
  if (hasPhases) {
    if (phaseKey === null) return { kind: 'AMBIGUOUS' };
    pool = candidates.filter((c) => c.phase && normalizeSearchText(c.phase) === phaseKey);
    if (pool.length === 0) return { kind: 'AMBIGUOUS' };
  }
  if (pool.length === 1) return { kind: 'FOUND', entry: pool[0] };
  const first = pool[0];
  const identical = pool.every(
    (c) => c.category === first.category && normalizeSearchText(c.name) === normalizeSearchText(first.name)
      && normalizeSearchText(c.phase || '') === normalizeSearchText(first.phase || '')
  );
  if (!identical) return { kind: 'AMBIGUOUS' };
  return { kind: 'FOUND', entry: [...pool].sort((a, b) => (a.id < b.id ? -1 : 1))[0] };
}

// Mapeia o item do trade. `findByNameKeyAnyCategory(nameKey)` devolve as entradas do catálogo (ordenadas).
// Sucesso: { ok: true, catalogEntry|null, category, name, variant, floatValue, paintSeed, phase }
//   (sem `catalogEntry` = categoria OUTRO, nome livre = market_hash_name)
// Falha: { ok: false, reason: 'CATALOG_NOT_FOUND' | 'CATALOG_AMBIGUOUS' }
function mapTradeItem(item, { findByNameKeyAnyCategory }) {
  const picked = pickCandidate(findByNameKeyAnyCategory(baseNameKey(item)), tradePhaseKey(item));
  if (picked.kind === 'AMBIGUOUS') return { ok: false, reason: 'CATALOG_AMBIGUOUS' };
  if (picked.kind === 'NOT_FOUND') {
    if (!isFreeNameItem(item.marketHashName)) return { ok: false, reason: 'CATALOG_NOT_FOUND' };
    return { ok: true, catalogEntry: null, category: 'OUTRO', name: item.marketHashName, variant: null, floatValue: null, paintSeed: null, phase: null };
  }
  const entry = picked.entry;
  const weapon = isWeaponCategory(entry.category);
  const hasFloat = weapon && !item.isCommodity && item.floatValue !== null && item.floatValue !== undefined;
  return {
    ok: true,
    catalogEntry: entry,
    category: entry.category,
    name: entry.name,
    variant: weapon ? variantOf(item) : null,
    floatValue: hasFloat ? item.floatValue : null,
    paintSeed: hasFloat && item.paintSeed !== null ? item.paintSeed : null,
    // Com fase no catálogo, ela é derivada (mandar a fase daria CATALOG_DERIVED_FIELD).
    phase: weapon && (entry.phase === null || entry.phase === undefined) && item.phase ? item.phase : null,
  };
}

// Fim do trade lock: o fim exato da proteção da Steam; sem ele, aceite + 7 dias (a mesma conta da D161, chamada explicitamente).
function computeTradeUnlockAt(trade) {
  if (trade.protectionEndsAt) return trade.protectionEndsAt;
  if (!trade.acceptedAt) return null;
  return new Date(Date.parse(trade.acceptedAt) + IMPORT_DEFAULT_TRADE_LOCK_DAYS * 86400000).toISOString();
}

// Corpo do `itemService.createItem` para uma compra importada. `inspectLink`, `assetId` e `originDetail` nunca são enviados.
function buildPurchaseInput(trade, mapped, { storeId }) {
  const input = {
    acquisitionType: 'COMPRA',
    purchaseStoreId: storeId,
    purchasePriceCents: trade.priceCents,
    acquiredAt: trade.soldAt || trade.acceptedAt || trade.createdAt,
    tradeUnlockAt: computeTradeUnlockAt(trade),
  };
  if (mapped.catalogEntry) input.catalogId = mapped.catalogEntry.id;
  else {
    input.category = mapped.category;
    input.name = mapped.name;
  }
  if (isWeaponCategory(mapped.category)) {
    input.variant = mapped.variant;
    if (mapped.floatValue !== null) input.floatValue = mapped.floatValue;
    if (mapped.paintSeed !== null) input.paintSeed = mapped.paintSeed;
    if (mapped.phase) input.phase = mapped.phase;
  }
  return input;
}

module.exports = {
  baseNameKey, variantOf, tradePhaseKey, isFreeNameItem, pickCandidate, mapTradeItem, computeTradeUnlockAt, buildPurchaseInput,
};
