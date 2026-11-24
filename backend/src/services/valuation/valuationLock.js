'use strict';

// Trava em memória da atualização de preços (D364 item 7), no mesmo molde do `importLock`.
const { ConflictError } = require('../../errors/AppError');

let inProgress = false;

const isValuationInProgress = () => inProgress;
const busyError = () => new ConflictError('Já há uma atualização de preços em andamento. Aguarde terminar.', 'VALUATION_IN_PROGRESS');

function acquire() {
  if (inProgress) throw busyError();
  inProgress = true;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      inProgress = false;
    }
  };
}

function assertIdle() {
  if (inProgress) throw busyError();
}

module.exports = { isValuationInProgress, acquire, assertIdle };
