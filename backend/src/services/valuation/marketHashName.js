'use strict';

// Nome de mercado e chave de cache de uma unidade ou componente (D364 item 4). Funções puras.
// O float não entra na chave: o preço é do item igual (nome + fase).
const { DOPPLER_PHASES_BY_FINISH } = require('../imports/adapters/csfloatStates');

const EXTERIOR_NAMES = Object.freeze({ FN: 'Factory New', MW: 'Minimal Wear', FT: 'Field-Tested', WW: 'Well-Worn', BS: 'Battle-Scarred' });
const WEAPON = ['SKIN', 'FACA', 'LUVA'];
const isNil = (v) => v === null || v === undefined;
const norm = (text) => String(text).trim().toLowerCase();

// Inverso de DOPPLER_PHASES_BY_FINISH: por acabamento, fase normalizada -> paint_index.
const PHASE_INDEX = Object.freeze(Object.fromEntries(Object.entries(DOPPLER_PHASES_BY_FINISH).map(([finish, table]) => [
  finish,
  new Map(Object.entries(table).map(([index, phase]) => [norm(phase), Number(index)])),
])));

// Tabela de fases do item (chave de DOPPLER_PHASES_BY_FINISH), ou null se o acabamento não tem fases conhecidas.
function phaseTableOf({ category, name }) {
  const text = String(name ?? '').trim();
  if (category === 'FACA') {
    if (/\|\s*Gamma Doppler$/i.test(text)) return 'GAMMA_DOPPLER_KNIFE';
    if (/\|\s*Doppler$/i.test(text)) return 'DOPPLER_KNIFE';
    return null;
  }
  if (category === 'SKIN' && text.toLowerCase() === 'glock-18 | gamma doppler') return 'GLOCK_GAMMA_DOPPLER';
  return null;
}

// paint_index da fase do item, ou null (sem tabela para o acabamento, ou fase fora dela).
function paintIndexOf({ category, name, phase }) {
  const table = phaseTableOf({ category, name });
  if (!table) return null;
  return PHASE_INDEX[table].get(norm(phase)) ?? null;
}

const keyOf = (marketHashName, paintIndex) => `${marketHashName}|${isNil(paintIndex) ? '' : paintIndex}`;
const target = (marketHashName, paintIndex = null) => ({ marketHashName, paintIndex, priceKey: keyOf(marketHashName, paintIndex) });

function weaponTarget(item, entry) {
  const { category } = item;
  let name = String(item.name ?? '').trim();
  if (name === '') return { notPriceable: 'NOT_PRICEABLE' };
  const star = category === 'FACA' || category === 'LUVA';
  if (star) name = name.replace(/^★\s*/, '');
  let prefix = star ? '★ ' : '';
  if (item.variant === 'STATTRAK') prefix += 'StatTrak™ ';
  if (item.variant === 'SOUVENIR') prefix += 'Souvenir ';
  const vanilla = category === 'FACA' && !name.includes('|');
  let suffix = '';
  if (!vanilla) {
    if (isNil(item.exterior) || !EXTERIOR_NAMES[item.exterior]) return { notPriceable: 'NO_EXTERIOR' };
    suffix = ` (${EXTERIOR_NAMES[item.exterior]})`;
  }
  const phase = !isNil(item.phase) ? item.phase : entry && !isNil(entry.phase) ? entry.phase : null;
  let paintIndex = null;
  const hasPhase = !isNil(phase) && String(phase).trim() !== '';
  // Doppler/Gamma Doppler de faca e de arma: sem fase o preço do nome misturaria todas as fases (E-P2-Q54, E-P2-Q56).
  const isDopplerFinish = (category === 'FACA' || category === 'SKIN') && /\|\s*(Gamma )?Doppler\s*$/i.test(name);
  if (isDopplerFinish && !hasPhase) return { notPriceable: 'PHASE_REQUIRED' };
  if (hasPhase || isDopplerFinish) {
    paintIndex = paintIndexOf({ category, name, phase });
    if (paintIndex === null) return { notPriceable: 'PHASE_UNMAPPED' };
  }
  return target(`${prefix}${name}${suffix}`, paintIndex);
}

// `subject`: uma unidade (`category`, `name`, `variant`, `exterior`, `phase`, `catalogId`) ou um componente (`kind`, `name`).
// Devolve { marketHashName, paintIndex, priceKey } ou { notPriceable: 'NO_EXTERIOR' | 'PHASE_REQUIRED' | 'PHASE_UNMAPPED' | 'NOT_PRICEABLE' }.
function buildPriceTarget(subject, { catalogById = new Map() } = {}) {
  if (!subject) return { notPriceable: 'NOT_PRICEABLE' };
  const entry = !isNil(subject.catalogId) ? catalogById.get(subject.catalogId) ?? null : null;
  if (!isNil(subject.kind)) {
    // Componentes: o nome gravado ("Sticker | …", "Patch | …", "Charm | …", "Sticker Slab | …"). Sem o pattern do chaveiro.
    const name = String(subject.name ?? (entry ? entry.name : '')).trim();
    return name === '' ? { notPriceable: 'NOT_PRICEABLE' } : target(name);
  }
  if (WEAPON.includes(subject.category)) return weaponTarget(subject, entry);
  const name = String(subject.name ?? '').trim();
  return name === '' ? { notPriceable: 'NOT_PRICEABLE' } : target(name);
}

module.exports = { EXTERIOR_NAMES, phaseTableOf, paintIndexOf, buildPriceTarget };
