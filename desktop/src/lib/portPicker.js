'use strict';

// Escolha da porta do backend no desktop (D174): 3001; ocupada pelo próprio Skins Manager -> "já aberto";
// ocupada por outro programa -> primeira livre entre 3002 e 3010. A decisão é pura (checagens injetadas).
const net = require('net');
const http = require('http');

const HOST = '127.0.0.1';
const PREFERRED_PORT = 3001;
const FALLBACK_FIRST = 3002;
const FALLBACK_LAST = 3010;

// -> { kind: 'use', port } | { kind: 'already-running', port } | { kind: 'none' }
async function pickPort({
  isPortFree,
  isSkinsManager,
  preferred = PREFERRED_PORT,
  fallbackFirst = FALLBACK_FIRST,
  fallbackLast = FALLBACK_LAST,
}) {
  if (await isPortFree(preferred)) return { kind: 'use', port: preferred };
  if (await isSkinsManager(preferred)) return { kind: 'already-running', port: preferred };
  for (let port = fallbackFirst; port <= fallbackLast; port += 1) {
    if (await isPortFree(port)) return { kind: 'use', port };
  }
  return { kind: 'none' };
}

// Teste real: tenta escutar no mesmo endereço do backend e solta a porta.
function checkPortFree(port, host = HOST) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

// Pergunta a /api/health se quem responde é o Skins Manager (`app: 'skins-manager'`).
function probeSkinsManager(port, { host = HOST, timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/api/health', timeout: timeoutMs, headers: { Accept: 'application/json' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 10000) req.destroy();
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(Boolean(json && json.data && json.data.app === 'skins-manager'));
        } catch (err) {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

module.exports = { pickPort, checkPortFree, probeSkinsManager, PREFERRED_PORT, FALLBACK_FIRST, FALLBACK_LAST };
