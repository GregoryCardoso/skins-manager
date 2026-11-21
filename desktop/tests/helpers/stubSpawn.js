'use strict';

// Pré-carregado com `node -r`: troca child_process.spawnSync por um registro, para exercitar scripts/release.js
// de verdade sem rodar testes, stage nem publicar nada. STUB_FAIL_AT=<índice> faz o passo falhar.
const childProcess = require('child_process');

let index = 0;
childProcess.spawnSync = (command, args, options) => {
  const entry = { index, command, args, cwd: options && options.cwd, hasToken: Boolean(options && options.env && options.env.GH_TOKEN) };
  process.stdout.write(`STUB_CALL ${JSON.stringify(entry)}\n`);
  const failAt = process.env.STUB_FAIL_AT;
  const status = failAt !== undefined && String(index) === failAt ? 3 : 0;
  index += 1;
  return { status };
};
