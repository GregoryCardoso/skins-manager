// Preload (node -r) usado por tests/server.dataDir.test.js. Não é arquivo de teste.
// Registra na stdout cada tentativa de adquirir a trava, sem depender de nenhum arquivo da máquina.
const path = require('path');

const lockModule = require(path.resolve(__dirname, '..', '..', 'src', 'config', 'instanceLock.js'));
const original = lockModule.acquireLockVerified;
lockModule.acquireLockVerified = function spied(dir) {
  process.stdout.write(`[lock] acquire ${dir}\n`);
  return original.apply(this, arguments);
};
