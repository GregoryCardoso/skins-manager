const { ValidationError } = require('../errors/AppError');
const { isPlainObject } = require('./validationHelpers');
const {
  MAX_ANY_AMOUNT_CENTS, MAX_NAME_LENGTH, MAX_ORIGIN_DETAIL_LENGTH, CATALOG_ID_MAX_LENGTH,
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
  components: { components: true }, // 10.1 (D344): lista que substitui os componentes; ausente = não muda
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
  'netReceivedCents', 'netReceivedManual', 'soldAt', 'saleHoldDaysApplied',
];

// Forma de `components` (10.1, D353): lista de até 6 objetos com as chaves conhecidas; as regras (limites, catálogo, slot) são do service.
const COMPONENT_KEYS = { id: INTEGER, kind: STRING, catalogId: STRING, slot: INTEGER, wear: NUMBER, pattern: INTEGER };
const MAX_COMPONENTS_SHAPE = 6;

// `extra`: { field, params } (D113). Todo erro de forma informa o campo.
function fail(message, code, extra) {
  return new ValidationError(message, code, extra);
}

const isObject = isPlainObject;

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
    if (rule.components) {
      checkComponents(value, { allowId: mode === 'update' });
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
    // Forma: o teto de verdade é o da moeda da loja (maxAmountCents), aplicado no service; aqui só o maior teto de todas as moedas.
    if (rule.cents && value > MAX_ANY_AMOUNT_CENTS) {
      throw fail(`O campo ${key} excede o valor máximo permitido (${MAX_ANY_AMOUNT_CENTS} centavos).`, 'INVALID_AMOUNT', { field: key, params: { maxCents: MAX_ANY_AMOUNT_CENTS } });
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

// `allowId`: só o PATCH aceita `id` (o componente aplicado do estoque que muda de slot, desgaste ou pattern; D362).
function checkComponents(value, { allowId = false } = {}) {
  if (!Array.isArray(value)) throw fail('O campo components deve ser uma lista.', 'INVALID_FIELD', { field: 'components' });
  if (value.length > MAX_COMPONENTS_SHAPE) {
    throw fail('Limite de componentes excedido.', 'COMPONENT_LIMIT_EXCEEDED', { field: 'components', params: { max: MAX_COMPONENTS_SHAPE } });
  }
  value.forEach((component, index) => {
    if (!isObject(component)) throw fail('Cada componente deve ser um objeto.', 'INVALID_FIELD', { field: 'components', params: { index } });
    for (const [key, entry] of Object.entries(component)) {
      if (!Object.prototype.hasOwnProperty.call(COMPONENT_KEYS, key) || (key === 'id' && !allowId)) {
        throw fail(`Campo desconhecido: ${key}`, 'UNKNOWN_FIELD', { field: 'components', params: { index, field: key } });
      }
      if (entry === null) continue; // nulo = ausente; o service responde com o código específico
      if (!matchesType(entry, COMPONENT_KEYS[key])) {
        throw fail(`Valor inválido em components[${index}].${key}.`, 'INVALID_COMPONENT_FIELD', { field: 'components', params: { index, field: key } });
      }
      if (key === 'catalogId' && (entry.length > CATALOG_ID_MAX_LENGTH || !CATALOG_ID_PATTERN.test(entry))) {
        throw fail(`Valor inválido em components[${index}].catalogId.`, 'INVALID_COMPONENT_FIELD', { field: 'components', params: { index, field: key } });
      }
    }
  });
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

// Os POSTs off-sale e for-sale aceitam só o corpo vazio `{}` (D265); `offSaleAt`/`forSaleSince` não são editáveis no PATCH.
const validateSaleStateBody = validateUnsellBody;

const MAX_BULK_IDS = 500;

// POST bulk/off-sale e bulk/for-sale (9.5.1a, D332): `{ groupKey, quantity? }` ou `{ itemIds }`, exatamente um dos dois.
const validateBulkSaleStateBody = wrap((req) => {
  const body = req.body;
  if (!isObject(body)) throw fail('O corpo da requisição deve ser um objeto JSON.', 'INVALID_BODY');
  const extra = Object.keys(body).find((key) => !['groupKey', 'quantity', 'itemIds'].includes(key));
  if (extra) throw fail(`Campo desconhecido: ${extra}`, 'UNKNOWN_FIELD', { field: extra });
  const byGroup = body.groupKey !== undefined;
  const bySelection = body.itemIds !== undefined;
  if (byGroup === bySelection) throw fail('Informe groupKey ou itemIds (um dos dois).', 'INVALID_FIELD', { field: byGroup ? 'itemIds' : 'groupKey' });
  if (byGroup) {
    if (typeof body.groupKey !== 'string' || body.groupKey.trim() === '' || body.groupKey.length > 500) {
      throw fail('groupKey inválido.', 'INVALID_FIELD', { field: 'groupKey' });
    }
    if (body.quantity !== undefined && body.quantity !== null && (!Number.isSafeInteger(body.quantity) || body.quantity < 1)) {
      throw fail('A quantidade deve ser um inteiro maior que zero.', 'INVALID_FIELD', { field: 'quantity' });
    }
    return;
  }
  if (body.quantity !== undefined) throw fail('quantity só vale com groupKey.', 'INVALID_FIELD', { field: 'quantity' });
  const ids = body.itemIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_BULK_IDS
    || !ids.every((id) => Number.isSafeInteger(id) && id > 0) || new Set(ids).size !== ids.length) {
    throw fail(`itemIds deve ter de 1 a ${MAX_BULK_IDS} ids inteiros positivos, sem repetição.`, 'INVALID_FIELD', { field: 'itemIds' });
  }
});

function queryValue(query, key, allowed) {
  const raw = query[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || (allowed && !allowed.includes(raw))) {
    throw fail(`Valor inválido para ${key}.`, 'INVALID_QUERY', { field: key });
  }
  return raw;
}

const MAX_SEARCH_LENGTH = 100;

// Busca pelo nome (12.5b): texto aparado de 1 a 100 caracteres; vazio ou maior que isso é recusado.
function searchValue(query) {
  const raw = queryValue(query, 'search');
  if (raw === undefined) return undefined;
  const text = raw.trim();
  if (text === '' || text.length > MAX_SEARCH_LENGTH) {
    throw fail(`search deve ter de 1 a ${MAX_SEARCH_LENGTH} caracteres.`, 'INVALID_QUERY', { field: 'search' });
  }
  return text;
}

const validateItemQuery = wrap((req) => {
  const q = req.query;
  const status = queryValue(q, 'status', ['EM_ESTOQUE', 'VENDIDO', 'CONSUMIDO']);
  const category = queryValue(q, 'category', CATEGORIES);
  const sortBy = queryValue(q, 'sortBy', ['age', 'turnaround']);
  const order = queryValue(q, 'order', ['asc', 'desc']);
  const stagnantOnly = queryValue(q, 'stagnantOnly', ['true', 'false']);
  const saleState = queryValue(q, 'saleState', ['FOR_SALE', 'OFF_SALE']);
  const search = searchValue(q);
  if (saleState !== undefined && status !== undefined && status !== 'EM_ESTOQUE') {
    throw fail('saleState só vale para itens em estoque.', 'INVALID_QUERY', { field: 'saleState' });
  }
  if (order !== undefined && sortBy === undefined) {
    throw fail('order só pode ser usado junto com sortBy.', 'INVALID_QUERY', { field: 'order' });
  }
  req.validatedQuery = {
    status,
    category,
    sortBy,
    order: sortBy ? order ?? (sortBy === 'age' ? 'desc' : 'asc') : undefined,
    stagnantOnly: stagnantOnly === 'true',
    saleState,
    search,
  };
});

// GET /api/items/groups (D274): só itens em estoque (status não é aceito) e só a ordenação por idade.
const validateGroupQuery = wrap((req) => {
  const q = req.query;
  if (q.status !== undefined) {
    throw fail('status não é aceito na visão agrupada (só itens em estoque).', 'INVALID_QUERY', { field: 'status' });
  }
  const category = queryValue(q, 'category', CATEGORIES);
  const sortBy = queryValue(q, 'sortBy', ['age']);
  const order = queryValue(q, 'order', ['asc', 'desc']);
  const stagnantOnly = queryValue(q, 'stagnantOnly', ['true', 'false']);
  const saleState = queryValue(q, 'saleState', ['FOR_SALE', 'OFF_SALE']);
  const search = searchValue(q);
  if (order !== undefined && sortBy === undefined) {
    throw fail('order só pode ser usado junto com sortBy.', 'INVALID_QUERY', { field: 'order' });
  }
  req.validatedQuery = {
    category,
    sortBy,
    order: sortBy ? order ?? 'desc' : undefined,
    stagnantOnly: stagnantOnly === 'true',
    saleState,
    search,
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
  // T34: float e paint seed ficam fora da chave do histórico (2.7); recusar evita uma resposta que ignora o filtro.
  for (const [field, value] of [['floatValue', floatValue], ['paintSeed', paintSeed]]) {
    if (value !== undefined) {
      throw fail(`O parâmetro ${field} não faz parte da chave do histórico.`, 'INVALID_QUERY', { field });
    }
  }
  assertWeaponAttributesAllowed(category, { variant: informedVariant, exterior, floatValue, paintSeed, phase });
  req.validatedQuery = {
    name,
    category,
    // SKIN/FACA/LUVA sem variant caem em NORMAL (mesma regra do cadastro).
    variant: informedVariant ?? (isWeapon ? 'NORMAL' : undefined),
    exterior,
    phase,
  };
});

function dayParam(q, key) {
  const raw = queryValue(q, key);
  if (raw === undefined) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d) return raw;
  }
  throw fail(`Valor inválido para ${key}.`, 'INVALID_QUERY', { field: key });
}

const validateSalesQuery = wrap((req) => {
  const q = req.query;
  const rawStore = queryValue(q, 'saleStoreId');
  if (rawStore !== undefined && !/^[1-9]\d{0,14}$/.test(rawStore)) {
    throw fail('Valor inválido para saleStoreId.', 'INVALID_QUERY', { field: 'saleStoreId' });
  }
  const soldFrom = dayParam(q, 'soldFrom');
  const soldTo = dayParam(q, 'soldTo');
  if (soldFrom !== undefined && soldTo !== undefined && soldFrom > soldTo) {
    throw fail('soldFrom não pode ser posterior a soldTo.', 'INVALID_QUERY', { field: 'soldTo' });
  }
  const sortBy = queryValue(q, 'sortBy', ['turnaround', 'soldAt']);
  const order = queryValue(q, 'order', ['asc', 'desc']);
  if (order !== undefined && sortBy === undefined) {
    throw fail('order só pode ser usado junto com sortBy.', 'INVALID_QUERY', { field: 'order' });
  }
  const effectiveSort = sortBy ?? 'soldAt';
  req.validatedQuery = {
    saleStoreId: rawStore === undefined ? undefined : Number(rawStore),
    soldFrom,
    soldTo,
    sortBy: effectiveSort,
    order: order ?? (effectiveSort === 'turnaround' ? 'asc' : 'desc'),
  };
});

module.exports = {
  checkBody,
  ACQUISITION_FIELDS,
  validateItemQuery,
  validateGroupQuery,
  validateStatsQuery,
  validateSalesQuery,
  validateCreateItemBody,
  validateUpdateItemBody,
  validateSellBody,
  validateUnsellBody,
  validateSaleStateBody,
  validateBulkSaleStateBody,
};
