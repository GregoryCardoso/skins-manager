'use strict';

// Adapter que abre uma pasta no Explorer (D175). Sem shell: o caminho é argumento, nunca texto de comando.
const { execFile } = require('child_process');

function canOpenFolder(platform = process.platform) {
  return platform === 'win32';
}

// Devolve uma Promise. O explorer.exe devolve código 1 mesmo com sucesso: só erro de spawn é falha.
function openFolder(dir, { execFileFn = execFile } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };
    try {
      const child = execFileFn('explorer.exe', [dir], { windowsHide: false }, (err) => {
        // erro de execução com código de saída é ignorado; só falha de spawn (sem `code` numérico) conta
        if (err && typeof err.code !== 'number') done(err);
        else done();
      });
      if (child && typeof child.on === 'function') child.on('error', done);
    } catch (err) {
      done(err);
    }
  });
}

module.exports = { openFolder, canOpenFolder };
