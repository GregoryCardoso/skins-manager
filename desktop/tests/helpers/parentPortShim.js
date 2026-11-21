'use strict';

// Simula o `process.parentPort` do utilityProcess do Electron (só para testes do backend/server.js).
// Mensagens enviadas ao pai saem no stdout como "@@MSG <json>"; mensagens do pai chegam por stdin (uma por linha).
const readline = require('readline');

const listeners = [];
process.parentPort = {
  postMessage(message) {
    process.stdout.write(`@@MSG ${JSON.stringify(message)}\n`);
  },
  on(event, handler) {
    if (event === 'message') listeners.push(handler);
  },
};

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  try {
    const data = JSON.parse(line);
    listeners.forEach((handler) => handler({ data }));
  } catch (err) {
    // ignora lixo
  }
});
