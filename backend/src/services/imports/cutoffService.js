'use strict';

// Data de corte da primeira importação (D296, D318 seção 5). A sugestão é só o valor inicial do campo: o usuário pode editá-la.
const Item = require('../../models/Item');
const Deposit = require('../../models/Deposit');
const { parseDate } = require('../dateUtils');
const { ValidationError } = require('../../errors/AppError');

// Função pura: a mais recente entre as datas informadas (ISO), ou null se não houver nenhuma.
function pickLatest(dates) {
  const valid = dates.filter((d) => typeof d === 'string' && d !== '');
  if (valid.length === 0) return null;
  return valid.reduce((best, current) => (Date.parse(current) > Date.parse(best) ? current : best));
}

// Sugestão = a mais recente entre: a compra manual (sem vínculo) na loja, a venda manual (sem vínculo) nela e o último aporte
// nela. Sem nada disso, nulo (o modal começa vazio e exige a data).
function suggest({ storeId }) {
  if (storeId === null || storeId === undefined) return null;
  const { purchaseAt, saleAt } = Item.latestUnlinkedDates(storeId);
  return pickLatest([purchaseAt, saleAt, Deposit.maxDepositedAt(storeId)]);
}

// Valida o corte informado: obrigatório (IMPORT_CUTOFF_REQUIRED), ISO válido (INVALID_DATE) e não futuro (DATE_IN_FUTURE).
// Devolve o ISO em UTC.
function validateCutoff(value, { now = new Date() } = {}) {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError('Informe a data de corte.', 'IMPORT_CUTOFF_REQUIRED', { field: 'cutoffAt' });
  }
  const date = parseDate(value, 'Data de corte', { field: 'cutoffAt' });
  if (date.getTime() > now.getTime()) {
    throw new ValidationError('A data de corte não pode ser futura.', 'DATE_IN_FUTURE', { field: 'cutoffAt' });
  }
  return date.toISOString();
}

module.exports = { pickLatest, suggest, validateCutoff };
