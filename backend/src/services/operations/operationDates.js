'use strict';

// Validação comum das datas das operações (D362 item 4, D363 item 4): não futura (dia de São Paulo), não anterior à aquisição das
// unidades envolvidas e, na aplicação retroativa, não posterior à venda. Erro `OPERATION_DATE_INVALID` com `params.reason`.
const { AppError, ValidationError } = require('../../errors/AppError');
const { assertNotFutureDay } = require('../inventoryAgingService');

const invalidDate = (message, reason, extra = {}, field = 'appliedAt') =>
  new AppError(422, 'OPERATION_DATE_INVALID', message, { field, params: { reason, ...extra } });

// `field`: campo do `assertNotFutureDay` (como era na 10.3); `errorField`: o campo informado no erro da operação.
function assertDate(date, { now, lowerBounds = [], soldAt = null, field = 'appliedAt', errorField = 'appliedAt' }) {
  try {
    assertNotFutureDay(date, now, { code: 'OPERATION_DATE_INVALID', message: 'A data não pode ser futura.', field });
  } catch (err) {
    if (err instanceof ValidationError) throw invalidDate('A data não pode ser futura.', 'FUTURE', {}, errorField);
    throw err;
  }
  for (const { reason, at } of lowerBounds) {
    if (date.getTime() < Date.parse(at)) throw invalidDate('A data não pode ser anterior à aquisição das unidades.', reason, { acquiredAt: at }, errorField);
  }
  if (soldAt !== null && date.getTime() > Date.parse(soldAt)) {
    throw invalidDate('A data não pode ser posterior à venda da arma.', 'AFTER_SALE', { soldAt }, errorField);
  }
}

module.exports = { invalidDate, assertDate };
