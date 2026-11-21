const { ValidationError } = require('../errors/AppError');
const { isPlainObject, requireJsonContentType } = require('./validationHelpers');
const { CATALOG_SEARCH_DEFAULT_LIMIT, CATALOG_SEARCH_MAX_LIMIT, CATALOG_ID_MAX_LENGTH } = require('../config/constants');
const { CATEGORIES } = require('../services/itemAttributesService');
const { normalizeSearchText } = require('../services/catalog/csgoApiAdapter');

// Validação de FORMA da rota do catálogo (D84); a busca em si fica no service.
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MIN_QUERY_LENGTH = 2;

const invalidQuery = (message) => new ValidationError(message, 'INVALID_QUERY');

function validateCatalogSearchQuery(req, res, next) {
  const { q, category, limit } = req.query;
  if (typeof q !== 'string' || normalizeSearchText(q).length < MIN_QUERY_LENGTH) {
    return next(invalidQuery(`Informe q com ao menos ${MIN_QUERY_LENGTH} caracteres.`));
  }
  if (category !== undefined && (typeof category !== 'string' || !CATEGORIES.includes(category))) {
    return next(invalidQuery('Categoria inválida.'));
  }
  let parsedLimit = CATALOG_SEARCH_DEFAULT_LIMIT;
  if (limit !== undefined) {
    parsedLimit = typeof limit === 'string' && /^\d+$/.test(limit) ? Number(limit) : NaN;
    if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > CATALOG_SEARCH_MAX_LIMIT) {
      return next(invalidQuery(`O limite deve ser um inteiro entre 1 e ${CATALOG_SEARCH_MAX_LIMIT}.`));
    }
  }
  req.validatedQuery = { q, category, limit: parsedLimit };
  return next();
}

function validateCatalogIdParam(req, res, next) {
  const id = req.params.id;
  if (typeof id !== 'string' || id.length > CATALOG_ID_MAX_LENGTH || !ID_PATTERN.test(id)) {
    return next(new ValidationError('Identificador inválido.', 'INVALID_ID'));
  }
  return next();
}

// Sem corpo: ausente ou `{}`; qualquer chave -> UNKNOWN_FIELD.
function validateRefreshBody(req, res, next) {
  // T44: exige Content-Type JSON (um POST sem corpo de outro site seria uma "simple request" de CORS).
  requireJsonContentType(req);
  const body = req.body === undefined ? {} : req.body;
  if (!isPlainObject(body)) {
    return next(new ValidationError('O corpo da requisição deve ser um objeto JSON.', 'INVALID_BODY'));
  }
  const extra = Object.keys(body)[0];
  if (extra) return next(new ValidationError(`Campo desconhecido: ${extra}`, 'UNKNOWN_FIELD'));
  return next();
}

module.exports = { validateCatalogSearchQuery, validateCatalogIdParam, validateRefreshBody };
