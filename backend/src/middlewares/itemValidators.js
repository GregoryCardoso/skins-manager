const { ValidationError } = require('../errors/AppError');
const {
  MAX_AMOUNT_CENTS, MAX_NAME_LENGTH, MAX_ORIGIN_DETAIL_LENGTH, CATALOG_ID_MAX_LENGTH,
  MAX_INSPECT_LINK_LENGTH, MAX_ASSET_ID_LENGTH, MAX_PHASE_LENGTH,
} = require('../config/constants');
const {
  CATEGORIES, VARIANTS, EXTERIORS, isWeaponCategory, assertWeaponAttributesAllowed, isAllowedInspectLink,
} = require('../services/itemAttributesService');

// Validação de FORMA (tipos JSON, campos permitidos, query). Regras semânticas ficam nos services.

const STRING = 'string';
const NUMBER = 'number';
const INTEGER = 'integer';

const CATALOG_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// Campos de aquisição/atributos (POST e PATCH). `required`: obrigatório no POST e não anulável no PATCH.
// `name` e `category` não são `required` aqui: a obrigatoriedade depende do `catalogId` e é do service (D78, D84).
const ACQUISITION_FIELDS = {
  catalogId: { type: STRING, catalogId: true },
  name: { type: STRING, maxLength: MAX_NAME_LENGTH },
  category: { type: STRING },
  acquisitionType: { type: STRING, required: true },
  variant: { type: STRING },
  floatValue: { type: NUMBER },
  exterior: { type: STRING },
  paintSeed: { type: NUMBER },
  phase: { type: STRING, maxLength: MAX_PHASE_LENGTH },
  inspectLink: { type: STRING, maxLength: MAX_INSPECT_LINK_LENGTH, inspectLink: true },
  assetId: { type: STRING, maxLength: MAX_ASSET_ID_LENGTH },
  originDetail: { type: STRING, maxLength: MAX_ORIGIN_DETAIL_LENGTH },
  purchaseStoreId: { type: INTEGER },
  purchasePriceCents: { type: NUMBER, cents: true },
  fxRateAtPurchase: { type: NUMBER },
  acquiredAt: { type: STRING, notNullable: true },
  tradeUnlockAt: { type: STRING },
};

const SALE_FIELDS = {
  saleStoreId: { type: INTEGER, required: true },
  salePriceCents: { type: NUMBER, required: true, cents: true },
  soldAt: { type: STRING, required: true },
  fxRateAtSale: { type: NUMBER },
  netReceivedCents: { type: INTEGER, cents: true },
};

// Campos de venda e status: travados no PATCH (D60).
const LOCKED_FIELDS = [
  'status', 'saleStoreId', 'salePriceCents', 'saleCurrency', 'fxRateAtSale', 'saleFeeTypeApplied',
  'saleFeeRateApplied', 'saleFeeRoundingApplied', 'saleMinFeeCentsApplied', 'saleFixedFeeCentsApplied',
  'netReceivedCents', 'netReceivedManual', 'soldAt',
];

// `extra`: { field, params } (D113). Todo erro de forma informa o campo.
function fail(message, code, extra) {
  return new ValidationError(message, code, extra);
}

function isObject(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
}

function matchesType(value, type) {
  if (type === STRING) return typeof value === 'string';
  if (type === NUMBER) return typeof value === 'number' && Number.isFinite(value);
  return typeof value === 'number' && Number.isSafeInteger(value);
}

// Valida o corpo contra a lista branca. `mode`: 'create' | 'update' | 'sell'.
function checkBody(body, spec, mode) {
  if (!isObject(body)) throw fail('O corpo da requisição deve ser um objeto JSON.', 'INVALID_BODY');
  for (const key of Object.keys(body)) {
    if (!Object.prototype.hasOwnProperty.call(spec, key)) throw fail(`Campo desconhecido: ${key}`, 'UNKNOWN_FIELD', { field: key });
  }
  for (const [key, rule] of Object.entries(spec)) {
    const value = body[key];
    if (value === undefined) {
      if (mode !== 'update' && rule.required) throw fail(`O campo ${key} é obrigatório.`, 'REQUIRED_FIELD', { field: key });
      continue;
    }
    if (value === null) {
      if (mode === 'create' && rule.required) throw fail(`O campo ${key} é obrigatório.`, 'REQUIRED_FIELD', { field: key });
      if (mode === 'sell' && rule.required) throw fail(`O campo ${key} é obrigatório.`, 'REQUIRED_FIELD', { field: key });
      if (mode === 'update' && (rule.required || rule.notNullable)) {
        throw fail(`O campo ${key} não pode ser nulo.`, 'REQUIRED_FIELD', { field: key });
      }
      continue;
    }
    if (!matchesType(value, rule.type)) {
      const expected = { [STRING]: 'texto', [NUMBER]: 'número', [INTEGER]: 'número inteiro' }[rule.type];
      throw fail(`O campo ${key} deve ser ${expected}.`, 'INVALID_FIELD', { field: key });
    }
    if (rule.cents && value > MAX_AMOUNT_CENTS) {
      throw fail(`O campo ${key} excede o valor máximo permitido (${MAX_AMOUNT_CENTS} centavos).`, 'INVALID_AMOUNT', { field: key, params: { maxCents: MAX_AMOUNT_CENTS } });
    }
    if (rule.catalogId) {
      if (value.length > CATALOG_ID_MAX_LENGTH) {
        throw fail(`O campo ${key} deve ter no máximo ${CATALOG_ID_MAX_LENGTH} caracteres.`, 'FIELD_TOO_LONG', {
          field: key, params: { maxLength: CATALOG_ID_MAX_LENGTH },
        });
      }
      if (!CATALOG_ID_PATTERN.test(value)) throw fail(`O campo ${key} é inválido.`, 'INVALID_FIELD', { field: key });
    }
    if (rule.maxLength && value.trim().length > rule.maxLength) {
      throw fail(`O campo ${key} deve ter no máximo ${rule.maxLength} caracteres.`, 'FIELD_TOO_LONG', {
        field: key, params: { maxLength: rule.maxLength },
      });
    }
    if (rule.inspectLink && !isAllowedInspectLink(value)) {
      throw fail('O link de inspeção deve começar com steam:// ou https://.', 'INVALID_FIELD', { field: key });
    }
  }
}

function wrap(fn) {
  return (req, res, next) => {
    try {
      fn(req);
      next();
    } catch (err) {
      next(err);
    }
  };
}

const validateCreateItemBody = wrap((req) => checkBody(req.body, ACQUISITION_FIELDS, 'create'));

const validateUpdateItemBody = wrap((req) => {
  const body = req.body;
  if (!isObject(body)) throw fail('O corpo da requisição deve ser um objeto JSON.', 'INVALID_BODY');
  // SALE_FIELDS_LOCKED vem antes de UNKNOWN_FIELD (D60).
  if (Object.keys(body).some((k) => LOCKED_FIELDS.includes(k))) {
    throw fail('Dados de venda não podem ser editados. Desfaça a venda e venda novamente.', 'SALE_FIELDS_LOCKED');
  }
  if (Object.keys(body).length === 0) throw fail('Informe ao menos um campo para atualizar.', 'INVALID_BODY');
  checkBody(body, ACQUISITION_FIELDS, 'update');
});

const validateSellBody = wrap((req) => checkBody(req.body, SALE_FIELDS, 'sell'));

const validateUnsellBody = wrap((req) => {
  const body = req.body === undefined ? {} : req.body;
  if (!isObject(body)) throw fail('O corpo da requisição deve ser um objeto JSON.', 'INVALID_BODY');
  const extra = Object.keys(body)[0];
  if (extra) throw fail(`Campo desconhecido: ${extra}`, 'UNKNOWN_FIELD', { field: extra });
});

function queryValue(query, key, allowed) {
  const raw = query[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || (allowed && !allowed.includes(raw))) {
    throw fail(`Valor inválido para ${key}.`, 'INVALID_QUERY', { field: key });
  }
  return raw;
}

const validateItemQuery = wrap((req) => {
  const q = req.query;
  const status = queryValue(q, 'status', ['EM_ESTOQUE', 'VENDIDO']);
  const category = queryValue(q, 'category', CATEGORIES);
  const sortBy = queryValue(q, 'sortBy', ['age', 'turnaround']);
  const order = queryValue(q, 'order', ['asc', 'desc']);
  const stagnantOnly = queryValue(q, 'stagnantOnly', ['true', 'false']);
  if (order !== undefined && sortBy === undefined) {
    throw fail('order só pode ser usado junto com sortBy.', 'INVALID_QUERY', { field: 'order' });
  }
  req.validatedQuery = {
    status,
    category,
    sortBy,
    order: sortBy ? order ?? (sortBy === 'age' ? 'desc' : 'asc') : undefined,
    stagnantOnly: stagnantOnly === 'true',
  };
});

const validateStatsQuery = wrap((req) => {
  const q = req.query;
  const name = queryValue(q, 'name');
  const category = queryValue(q, 'category', CATEGORIES);
  if (name === undefined || name.trim() === '') throw fail('O parâmetro name é obrigatório.', 'INVALID_QUERY', { field: 'name' });
  if (category === undefined) throw fail('O parâmetro category é obrigatório.', 'INVALID_QUERY', { field: 'category' });
  const isWeapon = isWeaponCategory(category);
  const informedVariant = queryValue(q, 'variant', VARIANTS);
  const exterior = queryValue(q, 'exterior', EXTERIORS);
  const floatValue = queryValue(q, 'floatValue');
  const paintSeed = queryValue(q, 'paintSeed');
  const phase = queryValue(q, 'phase');
  assertWeaponAttributesAllowed(category, { variant: informedVariant, exterior, floatValue, paintSeed, phase });
  req.validatedQuery = {
    name,
    category,
    // SKIN/FACA/LUVA sem variant caem em NORMAL (mesma regra do cadastro).
    variant: informedVariant ?? (isWeapon ? 'NORMAL' : undefined),
    exterior,
  };
});

module.exports = {
  validateItemQuery,
  validateStatsQuery,
  validateCreateItemBody,
  validateUpdateItemBody,
  validateSellBody,
  validateUnsellBody,
};
