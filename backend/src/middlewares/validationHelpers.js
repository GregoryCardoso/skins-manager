'use strict';

// Helpers comuns dos validadores de rota (T29, D153). Só validação de forma, sem regra de negócio.
const { AppError, ValidationError } = require('../errors/AppError');

const isNil = (value) => value === null || value === undefined;

// Objeto simples (não nulo, não array).
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Lança UNKNOWN_FIELD para a primeira chave fora da lista branca (`allowed`: array ou objeto).
function rejectUnknownFields(body, allowed) {
  const keys = Array.isArray(allowed) ? allowed : Object.keys(allowed);
  const unknown = Object.keys(body).find((key) => !keys.includes(key));
  if (unknown) throw new ValidationError(`Campo desconhecido: ${unknown}`, 'UNKNOWN_FIELD', { field: unknown });
}

// Exige `Content-Type: application/json` (protege POSTs sem corpo contra "simple requests" de outro site, T44).
function requireJsonContentType(req) {
  const type = String(req.get('content-type') || '').toLowerCase();
  if (!/^application\/json\s*(;|$)/.test(type)) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envie a requisição com Content-Type: application/json.');
  }
}

// Middleware de roteador: POST/PATCH/PUT exigem JSON, mesmo sem corpo (CSRF por "simple request").
// DELETE fica de fora: exige preflight de CORS, que recusa origens desconhecidas.
function requireJsonForWrites(req, res, next) {
  if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
    try {
      requireJsonContentType(req);
    } catch (err) {
      return next(err);
    }
  }
  return next();
}

module.exports = { isNil, isPlainObject, rejectUnknownFields, requireJsonContentType, requireJsonForWrites };
