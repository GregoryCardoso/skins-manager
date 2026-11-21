'use strict';

// Registro das fontes de cotação (D162). Todas seguem o contrato
// fetchLatestRate({ fetchFn, now }) -> { source, rate, buyRate, sellRate, quotedAt }.
const awesomeApiAdapter = require('./awesomeApiAdapter');
const bcbPtaxAdapter = require('./bcbPtaxAdapter');

const FX_PROVIDERS = Object.freeze({
  AWESOMEAPI: awesomeApiAdapter,
  PTAX: bcbPtaxAdapter,
});

function getProvider(source) {
  const provider = Object.prototype.hasOwnProperty.call(FX_PROVIDERS, source) ? FX_PROVIDERS[source] : null;
  if (!provider) throw new Error(`Fonte de cotação desconhecida: ${source}`);
  return provider;
}

module.exports = { FX_PROVIDERS, getProvider };
