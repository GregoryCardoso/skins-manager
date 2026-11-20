// Erro de aplicação com status HTTP e código estável, respeitado pelo errorHandler.
class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

class ValidationError extends AppError {
  constructor(message, code = 'VALIDATION_ERROR') {
    super(400, code, message);
    this.name = 'ValidationError';
  }
}

class NotFoundError extends AppError {
  constructor(message, code = 'NOT_FOUND') {
    super(404, code, message);
    this.name = 'NotFoundError';
  }
}

class ConflictError extends AppError {
  constructor(message, code = 'CONFLICT') {
    super(409, code, message);
    this.name = 'ConflictError';
  }
}

module.exports = { AppError, ValidationError, NotFoundError, ConflictError };
