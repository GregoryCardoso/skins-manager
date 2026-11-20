const { ValidationError } = require('../errors/AppError');
const { CATEGORIES, VARIANTS, EXTERIORS } = require('../services/itemAttributesService');

// Validação de FORMA (tipos JSON, campos permitidos, query). Regras semânticas ficam nos services.

const STRING = 'string';
const NUMBER = 'number';
const INTEGER = 'integer';

// Campos de aquisição/atributos (POST e PATCH). `required`: obrigatório no POST e não anulável no PATCH.
const ACQUISITION_FIELDS = {
  name: { type: STRING, required: true },
  category: { type: STRING, required: true },
  acquisitionType: { type: STRING, required: true },
  variant: { type: STRING },
  floatValue: { type: NUMBER },
  exterior: { type: STRING },
  paintSeed: { type: NUMBER },
  phase: { type: STRING },
  inspectLink: { type: STRING },
  assetId: { type: STRING },
  originDetail: { type: STRING },
  purchaseStoreId: { type: INTEGER },
  purchasePriceCents: { type: NUMBER },
  fxRateAtPurchase: { type: NUMBER },
  acquiredAt: { type: STRING, notNullable: true },
  tradeUnlockAt: { type: STRING },
};

const SALE_FIELDS = {
  saleStoreId: { type: INTEGER, required: true },
  salePriceCents: { type: NUMBER, required: true },
  soldAt: { type: STRING, required: true },
  fxRateAtSale: { type: NUMBER },
};

// Campos de venda e status: travados no PATCH (D60).
const LOCKED_FIELDS = [
  'status', 'saleStoreId', 'salePriceCents', 'saleCurrency', 'fxRateAtSale', 'saleFeeTypeApplied',
  'saleFeeRateApplied', 'saleFeeRoundingApplied', 'saleMinFeeCentsApplied', 'saleFixedFeeCentsApplied',
  'netReceivedCents', 'soldAt',
];

function fail(message, code) {
  return new ValidationError(message, code);
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
    if (!Object.prototype.hasOwnProperty.call(spec, key)) throw fail(`Campo desconhecido: ${key}`, 'UNKNOWN_FIELD');
  }
  for (const [key, rule] of Object.entries(spec)) {
    const value = body[key];
    if (value === undefined) {
      if (mode !== 'update' && rule.required) throw fail(`O campo ${key} é obrigatório.`, 'REQUIRED_FIELD');
      continue;
    }
    if (value === null) {
      if (mode === 'create' && rule.required) throw fail(`O campo ${key} é obrigatório.`, 'REQUIRED_FIELD');
      if (mode === 'sell' && rule.required) throw fail(`O campo ${key} é obrigatório.`, 'REQUIRED_FIELD');
      if (mode === 'update' && (rule.required || rule.notNullable)) {
        throw fail(`O campo ${key} não pode ser nulo.`, 'REQUIRED_FIELD');
      }
      continue;
    }
    if (!matchesType(value, rule.type)) {
      const expected = { [STRING]: 'texto', [NUMBER]: 'número', [INTEGER]: 'número inteiro' }[rule.type];
      throw fail(`O campo ${key} deve ser ${expected}.`, 'INVALID_FIELD');
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
  if (extra) throw fail(`Campo desconhecido: ${extra}`, 'UNKNOWN_FIELD');
});

function queryValue(query, key, allowed) {
  const raw = query[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || (allowed && !allowed.includes(raw))) {
    throw fail(`Valor inválido para ${key}.`, 'INVALID_QUERY');
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
    throw fail('order só pode ser usado junto com sortBy.', 'INVALID_QUERY');
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
  if (name === undefined || name.trim() === '') throw fail('O parâmetro name é obrigatório.', 'INVALID_QUERY');
  if (category === undefined) throw fail('O parâmetro category é obrigatório.', 'INVALID_QUERY');
  req.validatedQuery = {
    name,
    category,
    variant: queryValue(q, 'variant', VARIANTS),
    exterior: queryValue(q, 'exterior', EXTERIORS),
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
