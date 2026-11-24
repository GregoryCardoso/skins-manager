'use strict';

// Fontes de preço (D364 item 1). O cache só conhece a interface `fetchReference`; trocar de fonte = nova entrada aqui.
// `fetchReference({ marketHashName, paintIndex, apiKey, fetchFn, totalSignal, totalDeadlineAt, nowFn, sleepFn })`
//   -> { status: 'OK'|'NOT_FOUND', basePriceCents, referenceQuantity, sourceUpdatedAt, rateLimit }
const csfloatAdapter = require('../imports/adapters/csfloatAdapter');

const SOURCES = Object.freeze({
  CSFLOAT_LISTINGS: Object.freeze({
    id: 'CSFLOAT_LISTINGS',
    adapterSource: 'CSFLOAT',
    fetchReference: (params) => csfloatAdapter.getReferencePrice(params),
  }),
});

const ACTIVE_VALUATION_SOURCE = 'CSFLOAT_LISTINGS';

const getSource = (id = ACTIVE_VALUATION_SOURCE) => SOURCES[id];

module.exports = { SOURCES, ACTIVE_VALUATION_SOURCE, getSource };
