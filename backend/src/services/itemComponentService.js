'use strict';

// Componentes aplicados (stickers, chaveiro, Sticker Slab e patches), 2.2.2 e D343/D353. Regras puras: o acesso ao
// catálogo entra por `findCatalogById`. Componentes não mudam custo, saldo, giro, lucro nem itemStats.
const { ValidationError } = require('../errors/AppError');

const KINDS = Object.freeze(['STICKER', 'CHARM', 'STICKER_SLAB', 'PATCH']);
const MAX_STICKERS = 5; // até a confirmação do jogo (D343)
const MAX_HANGING = 1; // um pendurado: chaveiro OU Sticker Slab
const MAX_PATCHES = 3;
const MAX_PATTERN = 999999;
const MAX_NAME = 200;

const HANGING_KINDS = ['CHARM', 'STICKER_SLAB'];
// Categoria do item que recebe cada tipo, e categoria do catálogo exigida para o `catalogId`.
const HOST_CATEGORY = { STICKER: 'SKIN', CHARM: 'SKIN', STICKER_SLAB: 'SKIN', PATCH: 'PERSONAGEM' };
const CATALOG_CATEGORY = { STICKER: 'STICKER', CHARM: 'PINGENTE', STICKER_SLAB: 'STICKER', PATCH: 'PATCH' };
const SLOT_MAX = { STICKER: MAX_STICKERS - 1, CHARM: 0, STICKER_SLAB: 0, PATCH: MAX_PATCHES - 1 };

const isNil = (v) => v === null || v === undefined;
const isHanging = (kind) => HANGING_KINDS.includes(kind);

// Sticker e patch colados não saem (só se raspam); chaveiro e slab são removíveis (D343, D359).
function isDetachable(kind) {
  return isHanging(kind);
}

// Tipos aceitos por uma categoria de item (vazio = não aceita componentes).
function allowedKindsFor(category) {
  return KINDS.filter((kind) => HOST_CATEGORY[kind] === category);
}

function componentError(code, message, index, extra = {}) {
  return new ValidationError(message, code, { field: 'components', params: { index, ...extra } });
}

function stripPrefix(name, prefix) {
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

// Nome canônico gravado: o do catálogo; no slab, "Sticker Slab | <sticker>".
function buildName(kind, catalogName) {
  const name = kind === 'STICKER_SLAB' ? `Sticker Slab | ${stripPrefix(catalogName, 'Sticker | ')}` : catalogName;
  return name.length > MAX_NAME ? name.slice(0, MAX_NAME) : name;
}

function checkNumbers(kind, input, index) {
  const { slot, wear, pattern } = input;
  if (!isNil(slot) && (!Number.isSafeInteger(slot) || slot < 0 || slot > SLOT_MAX[kind])) {
    throw componentError('INVALID_COMPONENT_FIELD', `Slot inválido para ${kind}.`, index, { field: 'slot', max: SLOT_MAX[kind] });
  }
  if (!isNil(wear)) {
    if (kind !== 'STICKER') throw componentError('INVALID_COMPONENT_FIELD', 'Desgaste só vale para sticker colado.', index, { field: 'wear' });
    if (typeof wear !== 'number' || !Number.isFinite(wear) || wear < 0 || wear >= 1) {
      throw componentError('INVALID_COMPONENT_FIELD', 'O desgaste deve estar entre 0 e menos de 1.', index, { field: 'wear' });
    }
  }
  if (!isNil(pattern)) {
    if (!isHanging(kind)) throw componentError('INVALID_COMPONENT_FIELD', 'Pattern só vale para chaveiro e Sticker Slab.', index, { field: 'pattern' });
    if (!Number.isSafeInteger(pattern) || pattern < 0 || pattern > MAX_PATTERN) {
      throw componentError('INVALID_COMPONENT_FIELD', `O pattern deve ser um inteiro de 0 a ${MAX_PATTERN}.`, index, { field: 'pattern', max: MAX_PATTERN });
    }
  }
}

function checkCatalog(kind, input, index, findCatalogById) {
  if (typeof input.catalogId !== 'string' || input.catalogId === '') {
    throw componentError('COMPONENT_CATALOG_REQUIRED', 'Escolha o item do componente no catálogo.', index);
  }
  const entry = findCatalogById(input.catalogId);
  if (!entry) {
    throw componentError('COMPONENT_CATALOG_REQUIRED', 'Escolha o item do componente no catálogo.', index);
  }
  if (entry.category !== CATALOG_CATEGORY[kind]) {
    throw componentError('COMPONENT_CATALOG_MISMATCH', 'O item do catálogo não é da categoria certa para este componente.', index, { kind });
  }
  return entry;
}

// Limites por tipo (5 stickers, 1 pendurado, 3 patches) sobre uma lista de componentes (linhas gravadas e/ou entradas).
function assertLimits(rows) {
  const count = (pred) => rows.filter((c) => pred(c.kind)).length;
  const limits = [[count((k) => k === 'STICKER'), MAX_STICKERS], [count(isHanging), MAX_HANGING], [count((k) => k === 'PATCH'), MAX_PATCHES]];
  for (const [n, max] of limits) {
    if (n > max) throw new ValidationError(`Limite de componentes excedido (máximo ${max}).`, 'COMPONENT_LIMIT_EXCEEDED', { field: 'components', params: { max } });
  }
}

// Quantos componentes de cada tipo ainda cabem na unidade.
function remainingFor(rows = []) {
  const { stickers, hanging, patches } = summarize(rows);
  return { stickers: Math.max(0, MAX_STICKERS - stickers), hanging: Math.max(0, MAX_HANGING - hanging), patches: Math.max(0, MAX_PATCHES - patches) };
}

// Valida a lista inteira para um item da `category` e devolve as linhas a gravar (origem `CAME_WITH`, fonte `MANUAL`).
// Lista vazia sempre vale (limpa). Ordem: tipo/categoria -> limites -> cada componente (campos, catálogo). Slot repetido vale: o CS2
// permite dois stickers no mesmo slot (D361).
// `existingRows`: componentes já gravados na unidade que continuam (os aplicados do estoque); contam nos limites (D362).
function normalizeComponents(input, { category, findCatalogById, source = 'MANUAL', existingRows = [] } = {}) {
  if (!Array.isArray(input)) throw new ValidationError('components deve ser uma lista.', 'INVALID_FIELD', { field: 'components' });
  if (input.length === 0) return [];
  const allowed = allowedKindsFor(category);
  input.forEach((component, index) => {
    if (!component || !KINDS.includes(component.kind)) {
      throw componentError('INVALID_COMPONENT_FIELD', 'Tipo de componente inválido.', index, { field: 'kind' });
    }
    if (!allowed.includes(component.kind)) {
      throw new ValidationError('Este item não aceita este tipo de componente.', 'COMPONENTS_NOT_ALLOWED', {
        field: 'components', params: { index, category },
      });
    }
  });
  assertLimits([...existingRows, ...input]);
  return input.map((component, index) => {
    const { kind } = component;
    checkNumbers(kind, component, index);
    const entry = checkCatalog(kind, component, index, findCatalogById);
    const slot = isNil(component.slot) ? null : component.slot;
    return {
      kind,
      catalogId: entry.id,
      name: buildName(kind, entry.name),
      slot,
      wear: isNil(component.wear) ? null : component.wear,
      pattern: isNil(component.pattern) ? null : component.pattern,
      purchaseReferenceCents: null,
      source,
      origin: 'CAME_WITH',
      sourceItemId: null,
      operationId: null,
    };
  });
}

// Componentes já gravados continuam válidos na categoria? (trocar a categoria sem limpar a lista é recusado).
function assertExistingAllowed(rows, category) {
  const allowed = allowedKindsFor(category);
  const bad = rows.findIndex((row) => !allowed.includes(row.kind));
  if (bad >= 0) {
    throw new ValidationError('Este item tem componentes que a nova categoria não aceita. Remova-os antes de trocar.', 'COMPONENTS_NOT_ALLOWED', {
      field: 'components', params: { index: bad, category },
    });
  }
}

function summarize(rows = []) {
  const stickers = rows.filter((r) => r.kind === 'STICKER').length;
  const hanging = rows.filter((r) => isHanging(r.kind)).length;
  const patches = rows.filter((r) => r.kind === 'PATCH').length;
  return { stickers, hanging, patches, kinds: [...new Set(rows.map((r) => r.kind))] };
}

// Visão pública: imagem e nome em pt-BR vêm do catálogo (por id); o nome canônico é o gravado.
// `undoableOf(row)`: o desfazer da aplicação vale para o componente? (só os aplicados do estoque; D362).
function toView(rows = [], { catalogById = new Map(), undoableOf = null } = {}) {
  return rows.map((row) => {
    const entry = isNil(row.catalogId) ? null : catalogById.get(row.catalogId);
    let namePtBr = entry ? entry.namePtBr ?? null : null;
    if (namePtBr && row.kind === 'STICKER_SLAB') namePtBr = `Sticker Slab | ${stripPrefix(namePtBr, 'Sticker | ')}`;
    return {
      id: row.id,
      kind: row.kind,
      catalogId: row.catalogId,
      name: row.name,
      namePtBr,
      imageUrl: entry ? entry.imageUrl ?? null : null,
      slot: row.slot,
      wear: row.wear,
      pattern: row.pattern,
      source: row.source,
      origin: row.origin,
      sourceItemId: row.sourceItemId ?? null,
      operationId: row.operationId ?? null,
      // Aplicado do estoque: pode ser desfeito (correção) e, se for sticker ou patch, removido para sempre (D362 itens 5 e 6).
      undoable: row.origin === 'APPLIED_FROM_STOCK' && undoableOf ? Boolean(undoableOf(row)) : false,
      scrapeable: row.origin === 'APPLIED_FROM_STOCK' && !isDetachable(row.kind),
    };
  });
}

// Resumo da API: `charms` conta o pendurado (chaveiro ou slab).
function toSummary(rows = []) {
  const { stickers, hanging } = summarize(rows);
  return { stickers, charms: hanging };
}

module.exports = {
  KINDS, CATALOG_CATEGORY, SLOT_MAX, MAX_STICKERS, MAX_HANGING, MAX_PATCHES, isDetachable, allowedKindsFor, normalizeComponents, assertExistingAllowed,
  assertLimits, remainingFor, checkNumbers, buildName, stripPrefix, summarize, toView, toSummary,
};
