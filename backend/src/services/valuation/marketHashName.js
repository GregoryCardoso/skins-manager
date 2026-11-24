'use strict';

// Nome de mercado e chave de cache de uma unidade ou componente (D364 item 4). Funções puras.
// O float não entra na chave: o preço é do item igual (nome + fase).
const { DOPPLER_PHASES } = require('../imports/adapters/csfloatStates');

const EXTERIOR_NAMES = Object.freeze({ FN: 'Factory New', MW: 'Minimal Wear', FT: 'Field-Tested', WW: 'Well-Worn', BS: 'Battle-Scarred' });
const WEAPON = ['SKIN', 'FACA', 'LUVA'];
const isNil = (v) => v === null || v === undefined;
const norm = (text) => String(text).trim().toLowerCase();

// Inverso de DOPPLER_PHASES por acabamento: Gamma Doppler = 568 a 572; Doppler = 415 a 421.
const PHASE_INDEX = (() => {
  const out = { DOPPLER: new Map(), GAMMA: new Map() };
  for (const [index, phase] of Object.entries(DOPPLER_PHASES)) {
    (Number(index) >= 568 ? out.GAMMA : out.DOPPLER).set(norm(phase), Number(index));
  }
  return out;
})();

// paint_index da fase de uma faca, ou null (fase fora da tabela, ou acabamento sem fases conhecidas, como a Gamma Doppler de armas).
function paintIndexOf({ category, name, phase }) {
  if (category !== 'FACA') return null;
  const finish = /\|\s*Gamma Doppler\s*$/i.test(name) ? PHASE_INDEX.GAMMA : /\|\s*Doppler\s*$/i.test(name) ? PHASE_INDEX.DOPPLER : null;
  if (!finish) return null;
  return finish.get(norm(phase)) ?? null;
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

module.exports = { EXTERIOR_NAMES, paintIndexOf, buildPriceTarget };
