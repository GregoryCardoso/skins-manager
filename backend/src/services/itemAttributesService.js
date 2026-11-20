'use strict';

const { ValidationError } = require('../errors/AppError');

const CATEGORIES = ['SKIN', 'FACA', 'LUVA', 'CAIXA', 'CAPSULA', 'STICKER', 'PINGENTE', 'PERSONAGEM', 'PASSE_BATALHA', 'OUTRO'];
const WEAPON_CATEGORIES = ['SKIN', 'FACA', 'LUVA'];
// D78: categorias que exigem item do catálogo e categorias de nome livre.
const CATALOG_CATEGORIES = ['SKIN', 'FACA', 'LUVA', 'CAIXA', 'CAPSULA', 'STICKER', 'PINGENTE', 'PERSONAGEM'];
const FREE_NAME_CATEGORIES = ['OUTRO', 'PASSE_BATALHA'];
const VARIANTS = ['NORMAL', 'STATTRAK', 'SOUVENIR'];
const EXTERIORS = ['FN', 'MW', 'FT', 'WW', 'BS'];

const isNil = (v) => v === null || v === undefined;

function isWeaponCategory(category) {
  return WEAPON_CATEGORIES.includes(category);
}

// Única regra de "atributos de arma só valem para SKIN, FACA e LUVA" (cadastro, edição e consultas).
function assertWeaponAttributesAllowed(category, attrs = {}) {
  if (isWeaponCategory(category)) return;
  const { variant, floatValue, exterior, paintSeed, phase } = attrs;
  const trimmedPhase = typeof phase === 'string' ? phase.trim() : phase;
  const phaseValue = trimmedPhase === '' ? null : trimmedPhase;
  if ([variant, floatValue, exterior, paintSeed, phaseValue].some((v) => !isNil(v))) {
    throw new ValidationError('Atributos de arma só valem para SKIN, FACA e LUVA.', 'ATTRIBUTES_NOT_ALLOWED');
  }
}

function deriveExterior(floatValue) {
  if (isNil(floatValue)) return null;
  if (typeof floatValue !== 'number' || !Number.isFinite(floatValue) || floatValue < 0 || floatValue > 1) {
    throw new ValidationError('O float deve ser um número entre 0 e 1.', 'INVALID_FLOAT');
  }
  if (floatValue < 0.07) return 'FN';
  if (floatValue < 0.15) return 'MW';
  if (floatValue < 0.38) return 'FT';
  if (floatValue < 0.45) return 'WW';
  return 'BS';
}

// 0.1 -> "0,10"; 0.065 -> "0,065" (até 4 casas, no mínimo 2).
function formatFloatRange(value) {
  const text = String(Number(value.toFixed(4)));
  const [int, dec = ''] = text.split('.');
  return `${int},${dec.padEnd(2, '0')}`;
}

// Faixa de float do catálogo (limites inclusivos). Sem faixa completa ou sem float, não checa.
function assertFloatInCatalogRange(floatValue, { minFloat, maxFloat } = {}) {
  if (isNil(floatValue) || isNil(minFloat) || isNil(maxFloat)) return;
  if (floatValue < minFloat || floatValue > maxFloat) {
    throw new ValidationError(
      `O float deste item deve estar entre ${formatFloatRange(minFloat)} e ${formatFloatRange(maxFloat)}.`,
      'FLOAT_OUT_OF_RANGE'
    );
  }
}

function normalizeAttributes({ category, variant, floatValue, exterior, paintSeed, phase } = {}) {
  if (!CATEGORIES.includes(category)) {
    throw new ValidationError('Categoria inválida.', 'INVALID_CATEGORY');
  }
  const trimmedPhase = typeof phase === 'string' ? phase.trim() : phase;
  const phaseValue = trimmedPhase === '' ? null : trimmedPhase;

  if (!isWeaponCategory(category)) {
    assertWeaponAttributesAllowed(category, { variant, floatValue, exterior, paintSeed, phase: phaseValue });
    return { variant: null, floatValue: null, exterior: null, paintSeed: null, phase: null };
  }

  const finalVariant = isNil(variant) ? 'NORMAL' : variant;
  if (!VARIANTS.includes(finalVariant)) {
    throw new ValidationError('Variante inválida.', 'INVALID_VARIANT');
  }
  if (category === 'LUVA' && finalVariant !== 'NORMAL') {
    throw new ValidationError('Luvas só podem ser da variante NORMAL.', 'INVALID_VARIANT');
  }
  if (category === 'FACA' && finalVariant === 'SOUVENIR') {
    throw new ValidationError('Facas não podem ser SOUVENIR.', 'INVALID_VARIANT');
  }

  const derived = deriveExterior(isNil(floatValue) ? null : floatValue);
  if (!isNil(exterior) && !EXTERIORS.includes(exterior)) {
    throw new ValidationError('Exterior inválido.', 'INVALID_EXTERIOR');
  }
  if (derived && !isNil(exterior) && exterior !== derived) {
    throw new ValidationError('Exterior incoerente com o float.', 'EXTERIOR_MISMATCH');
  }

  if (!isNil(paintSeed) && (!Number.isInteger(paintSeed) || paintSeed < 0 || paintSeed > 1000)) {
    throw new ValidationError('Paint seed deve ser um inteiro entre 0 e 1000.', 'INVALID_PAINT_SEED');
  }
  if (!isNil(phaseValue) && typeof phaseValue !== 'string') {
    throw new ValidationError('Fase inválida.', 'INVALID_PHASE');
  }

  return {
    variant: finalVariant,
    floatValue: isNil(floatValue) ? null : floatValue,
    exterior: derived ?? (isNil(exterior) ? null : exterior),
    paintSeed: isNil(paintSeed) ? null : paintSeed,
    phase: isNil(phaseValue) ? null : phaseValue,
  };
}

module.exports = {
  CATEGORIES, WEAPON_CATEGORIES, CATALOG_CATEGORIES, FREE_NAME_CATEGORIES, VARIANTS, EXTERIORS, isWeaponCategory,
  assertFloatInCatalogRange, assertWeaponAttributesAllowed, deriveExterior, normalizeAttributes,
};
