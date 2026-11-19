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

module.exports = { AppError, ValidationError };
