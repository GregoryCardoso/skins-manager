const { AppError, ValidationError, NotFoundError, ConflictError } = require('../../src/errors/AppError');

describe('errors/AppError', () => {
  test('AppError(status, code, message) guarda os campos e é um Error', () => {
    const err = new AppError(409, 'CONFLICT', 'Conflito');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ name: 'AppError', status: 409, code: 'CONFLICT', message: 'Conflito' });
    expect(typeof err.stack).toBe('string');
  });

  test('ValidationError: status 400 com o código informado (T25: o código é obrigatório)', () => {
    const err = new ValidationError('Campo inválido', 'INVALID_FIELD');
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ name: 'ValidationError', status: 400, code: 'INVALID_FIELD', message: 'Campo inválido' });
  });

  test('ValidationError aceita code customizado mantendo status 400', () => {
    const err = new ValidationError('Campo desconhecido: x', 'UNKNOWN_FIELD');
    expect(err).toMatchObject({ status: 400, code: 'UNKNOWN_FIELD', message: 'Campo desconhecido: x' });
  });

  test('NotFoundError (404) e ConflictError (409) com code', () => {
    expect(new NotFoundError('Item não encontrado.', 'ITEM_NOT_FOUND')).toMatchObject({
      name: 'NotFoundError', status: 404, code: 'ITEM_NOT_FOUND', message: 'Item não encontrado.',
    });
    expect(new ConflictError('Item já vendido.', 'ITEM_ALREADY_SOLD')).toMatchObject({
      name: 'ConflictError', status: 409, code: 'ITEM_ALREADY_SOLD',
    });
    expect(new NotFoundError('x', 'X_NOT_FOUND')).toBeInstanceOf(AppError);
    expect(new ConflictError('x', 'X_CONFLICT')).toBeInstanceOf(AppError);
  });
});
