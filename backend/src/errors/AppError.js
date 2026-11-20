// Erro de aplicação com status HTTP e código estável, respeitado pelo errorHandler.
class AppError extends Error {
  // `extra` opcional: { field, params } (D113). `field` é o campo da API; `params` interpola a mensagem no frontend.
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (extra && typeof extra.field === 'string') this.field = extra.field;
    if (extra && extra.params && typeof extra.params === 'object') this.params = extra.params;
  }
}

class ValidationError extends AppError {
  constructor(message, code = 'VALIDATION_ERROR', extra) {
    super(400, code, message, extra);
    this.name = 'ValidationError';
  }
}

class NotFoundError extends AppError {
  constructor(message, code = 'NOT_FOUND', extra) {
    super(404, code, message, extra);
    this.name = 'NotFoundError';
  }
}

class ConflictError extends AppError {
  constructor(message, code = 'CONFLICT', extra) {
    super(409, code, message, extra);
    this.name = 'ConflictError';
  }
}

// Falha de um serviço externo (502 Bad Gateway), ex.: download do catálogo.
class UpstreamError extends AppError {
  constructor(message, code = 'UPSTREAM_ERROR', extra) {
    super(502, code, message, extra);
    this.name = 'UpstreamError';
  }
}

module.exports = { AppError, ValidationError, NotFoundError, ConflictError, UpstreamError };
