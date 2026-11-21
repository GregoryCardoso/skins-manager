'use strict';

const net = require('net');
const http = require('http');
const { pickPort, checkPortFree, probeSkinsManager } = require('../src/lib/portPicker');

function fakes({ busy = [], skinsManagerOn = [] }) {
  const asked = [];
  return {
    asked,
    isPortFree: async (port) => {
      asked.push(port);
      return !busy.includes(port);
    },
    isSkinsManager: async (port) => skinsManagerOn.includes(port),
  };
}

describe('pickPort', () => {
  test('3001 livre: usa a 3001', async () => {
    expect(await pickPort(fakes({}))).toEqual({ kind: 'use', port: 3001 });
  });

  test('3001 ocupada pelo Skins Manager: avisa "já aberto" sem procurar outra', async () => {
    const f = fakes({ busy: [3001], skinsManagerOn: [3001] });
    expect(await pickPort(f)).toEqual({ kind: 'already-running', port: 3001 });
    expect(f.asked).toEqual([3001]);
  });

  test('3001 ocupada por outro programa: primeira livre de 3002 a 3010', async () => {
    expect(await pickPort(fakes({ busy: [3001, 3002, 3003] }))).toEqual({ kind: 'use', port: 3004 });
  });

  test('a 3010 ainda vale; tudo ocupado devolve none', async () => {
    const busy = [3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009];
    expect(await pickPort(fakes({ busy }))).toEqual({ kind: 'use', port: 3010 });
    expect(await pickPort(fakes({ busy: [...busy, 3010] }))).toEqual({ kind: 'none' });
  });
});

describe('checkPortFree (rede real, porta efêmera)', () => {
  test('porta em uso não está livre; depois de liberada, está', async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    expect(await checkPortFree(port)).toBe(false);
    await new Promise((resolve) => server.close(resolve));
    expect(await checkPortFree(port)).toBe(true);
  });
});

describe('probeSkinsManager (HTTP real, porta efêmera)', () => {
  function serve(body) {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
  }

  test('reconhece o health do Skins Manager', async () => {
    const { server, port } = await serve({ success: true, data: { status: 'ok', app: 'skins-manager' } });
    expect(await probeSkinsManager(port)).toBe(true);
    server.close();
  });

  test('outro serviço, JSON qualquer ou texto: falso', async () => {
    const a = await serve({ success: true, data: { app: 'outro' } });
    const b = await serve('não é json');
    expect(await probeSkinsManager(a.port)).toBe(false);
    expect(await probeSkinsManager(b.port)).toBe(false);
    a.server.close();
    b.server.close();
  });

  test('ninguém escutando: falso', async () => {
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address();
    await new Promise((resolve) => probe.close(resolve));
    expect(await probeSkinsManager(port, { timeoutMs: 500 })).toBe(false);
  });
});
