function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Rota não encontrada' },
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_JSON', message: 'JSON malformado no corpo da requisição' },
    });
  }

  const status = Number.isInteger(err && err.status) && err.status >= 400 && err.status < 600 ? err.status : null;
  if (status && err.code && typeof err.code === 'string') {
    return res.status(status).json({
      success: false,
      error: { code: err.code, message: err.message || 'Erro' },
    });
  }

  if (status && status < 500) {
    let code = 'BAD_REQUEST';
    let message = 'Requisição inválida';
    if (status === 413) {
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Corpo da requisição grande demais';
    } else if (status === 415) {
      code = 'UNSUPPORTED_MEDIA_TYPE';
      message = 'Tipo de conteúdo ou codificação não suportado';
    }
    return res.status(status).json({ success: false, error: { code, message } });
  }

  // Salvaguarda: o service deve impedir a violação antes; se escapar, é conflito e não erro interno.
  if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
    console.error(err);
    return res.status(409).json({
      success: false,
      error: { code: 'CONSTRAINT_VIOLATION', message: 'A operação viola uma restrição de integridade dos dados.' },
    });
  }

  console.error(err);
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' },
  });
}

module.exports = { errorHandler, notFoundHandler };
