const express = require('express');
const { AppError, ValidationError } = require('../errors/AppError');
const { BACKUP_MAX_BYTES } = require('../config/constants');

// Só valida a forma da requisição de importação (D151): tipo de conteúdo, tamanho e corpo binário.
const parsersByLimit = new Map();

function rawParserFor(limit) {
  if (!parsersByLimit.has(limit)) {
    parsersByLimit.set(limit, express.raw({ type: 'application/octet-stream', limit }));
  }
  return parsersByLimit.get(limit);
}

// Exige `Content-Type: application/octet-stream` (exige preflight de CORS, protegendo contra outro site).
function requireOctetStream(req, res, next) {
  const type = String(req.get('content-type') || '').toLowerCase();
  if (!/^application\/octet-stream\s*(;|$)/.test(type)) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envie o arquivo com Content-Type: application/octet-stream.');
  }
  return next();
}

// Lê o corpo como Buffer, com o limite de BACKUP_MAX_BYTES (ou `app.locals.backupMaxBytes`, usado nos testes).
function parseImportBody(req, res, next) {
  const limit = req.app.locals.backupMaxBytes || BACKUP_MAX_BYTES;
  rawParserFor(limit)(req, res, (err) => {
    if (err && err.status === 413) {
      return next(
        new AppError(413, 'PAYLOAD_TOO_LARGE', `O arquivo excede o limite de ${Math.round(limit / (1024 * 1024))} MB.`, {
          params: { maxBytes: limit },
        })
      );
    }
    if (err) return next(err);
    if (!Buffer.isBuffer(req.body)) req.body = Buffer.alloc(0); // corpo vazio: o service responde BACKUP_INVALID_FILE
    return next();
  });
}

module.exports = { requireOctetStream, parseImportBody, BACKUP_MAX_BYTES };

// POST /backup/open-folder (D175): JSON obrigatório e corpo `{}` (nenhum campo, em especial nenhum caminho).
function validateOpenFolderBody(req, res, next) {
  const type = String(req.get('content-type') || '').toLowerCase();
  if (!/^application\/json\s*(;|$)/.test(type)) {
    return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envie a requisição com Content-Type: application/json.'));
  }
  const body = req.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return next(new ValidationError('O corpo da requisição deve ser um objeto JSON vazio ({}).', 'INVALID_BODY'));
  }
  const unknown = Object.keys(body)[0];
  if (unknown !== undefined) {
    return next(new ValidationError(`Campo desconhecido: ${unknown}`, 'UNKNOWN_FIELD', { field: unknown }));
  }
  return next();
}

module.exports.validateOpenFolderBody = validateOpenFolderBody;
