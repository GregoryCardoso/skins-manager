'use strict';

// Lista ordenada de migrações (D69). A lista só cresce; migração publicada nunca é editada.
const v001 = require('./v001_initial');
const v002 = require('./v002_catalog');
const v003 = require('./v003_manual_net');
const v004 = require('./v004_stores_settings');
const v005 = require('./v005_fx_sources');
const v006 = require('./v006_withdrawal_fee_sale_hold');
const v007 = require('./v007_store_currency_flows');

const MIGRATIONS = Object.freeze([v001, v002, v003, v004, v005, v006, v007]);

module.exports = { MIGRATIONS };
