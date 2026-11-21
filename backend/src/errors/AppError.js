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

// T25 (D153): o código é obrigatório nas subclasses; sem ele é erro de programação (vira 500 genérico no errorHandler).
function requireCode(className, code) {
  if (typeof code !== 'string' || code.trim() === '') {
    throw new Error(`${className} exige um código de erro (segundo argumento).`);
  }
}

class ValidationError extends AppError {
  constructor(message, code, extra) {
    requireCode('ValidationError', code);
    super(400, code, message, extra);
    this.name = 'ValidationError';
  }
}

class NotFoundError extends AppError {
  constructor(message, code, extra) {
    requireCode('NotFoundError', code);
    super(404, code, message, extra);
    this.name = 'NotFoundError';
  }
}

class ConflictError extends AppError {
  constructor(message, code, extra) {
    requireCode('ConflictError', code);
    super(409, code, message, extra);
    this.name = 'ConflictError';
  }
}

// Falha de um serviço externo (502 Bad Gateway), ex.: download do catálogo.
class UpstreamError extends AppError {
  constructor(message, code, extra) {
    requireCode('UpstreamError', code);
    super(502, code, message, extra);
    this.name = 'UpstreamError';
  }
}

module.exports = { AppError, ValidationError, NotFoundError, ConflictError, UpstreamError };
