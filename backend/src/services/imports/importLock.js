'use strict';

// Trava em memória das operações de importação (D303, D318). Basta uma trava por processo: a pasta de dados aceita uma única
// instância por vez (instanceLock). Fica num módulo próprio para o backup e a integração a consultarem sem dependência circular.
const { ConflictError } = require('../../errors/AppError');

let inProgress = false;

function isImportInProgress() {
  return inProgress;
}

const busyError = () => new ConflictError('Já há uma importação em andamento. Aguarde terminar.', 'IMPORT_IN_PROGRESS');

// Pega a trava (síncrono: duas chamadas simultâneas nunca passam as duas). Devolve a função que a libera (idempotente).
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

// Recusa se houver importação em andamento (usado por "Trocar de conta").
function assertIdle() {
  if (inProgress) throw busyError();
}

module.exports = { isImportInProgress, acquire, assertIdle };
