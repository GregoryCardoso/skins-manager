'use strict';

// Lista ordenada de migrações (D69). A lista só cresce; migração publicada nunca é editada.
const v001 = require('./v001_initial');
const v002 = require('./v002_catalog');

const MIGRATIONS = Object.freeze([v001, v002]);

module.exports = { MIGRATIONS };
