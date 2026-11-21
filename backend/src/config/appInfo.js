'use strict';

// Identificação do app (D174/D176): `app` e `version` no /api/health. Versão lida do backend/package.json.
const pkg = require('../../package.json');

module.exports = { APP_NAME: 'skins-manager', APP_VERSION: pkg.version };
