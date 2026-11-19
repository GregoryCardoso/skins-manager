// Preload (node -r) usado por tests/server.test.js: marca na stderr quando closeDb() é chamado.
// Não é arquivo de teste. Envolve o export antes de server.js desestruturá-lo.
const Module = require('module');
const path = require('path');

const target = path.resolve(__dirname, '..', '..', 'src', 'config', 'database.js');
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  const exported = originalLoad.apply(this, arguments);
  let resolved;
  try {
    resolved = Module._resolveFilename(request, parent, isMain);
  } catch (e) {
    return exported;
  }
  if (resolved === target && exported && !exported.__closeDbSpied) {
    const original = exported.closeDb;
    exported.closeDb = function spiedCloseDb() {
      process.stderr.write('[spy] closeDb chamado\n');
      return original.apply(this, arguments);
    };
    exported.__closeDbSpied = true;
  }
  return exported;
};
