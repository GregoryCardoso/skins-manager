'use strict';

// POST /api/market-values/refresh (D364): corpo `{}` (ou vazio); qualquer campo -> UNKNOWN_FIELD. Não há escopo nem botão: os
// preços são atualizados só ao abrir o app, e só os desatualizados.
const { ValidationError } = require('../errors/AppError');
const { isPlainObject, rejectUnknownFields } = require('./validationHelpers');

function validateRefreshBody(req, res, next) {
  const body = req.body === undefined ? {} : req.body;
  if (!isPlainObject(body)) throw new ValidationError('O corpo da requisição deve ser um objeto JSON.', 'INVALID_BODY');
  rejectUnknownFields(body, []);
  return next();
}

module.exports = { validateRefreshBody };
