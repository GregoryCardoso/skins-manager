// QA da revisão da Etapa 7 (D172/D173): sondagem da trava com servidor HTTP real em 127.0.0.1, limites de idade,
// travas sem porta/ilegíveis e o server.js de verdade (processo filho) com PID reaproveitado.
// Nunca usa a porta 3001 nem a pasta de dados real.
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  acquireLockVerified,
  removeStaleLockByProbe,
  probeSkinsManager,
  STARTUP_GRACE_MS,
  LOCK_FILE_NAME,
} = require('../../src/config/instanceLock');

const BACKEND_DIR = path.resolve(__dirname, '..', '..');
const SERVER = path.join(BACKEND_DIR, 'server.js');
const REDIRECT = path.join(__dirname, '..', 'helpers', 'redirectLegacyDir.js');

jest.setTimeout(40000);

let tmp;
let lockPath;
const servers = [];
const children = [];
const NOW = new Date('2026-01-01T12:00:00.000Z');
const OLD = '2026-01-01T10:00:00.000Z';

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-lockgaps-'));
  lockPath = path.join(tmp, LOCK_FILE_NAME);
});

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop();
    s.closeAllConnections?.();
    await new Promise((resolve) => s.close(resolve));
  }
  const exits = [];
  while (children.length) {
    const c = children.pop();
    if (c.exitCode === null) {
      exits.push(new Promise((resolve) => c.once('exit', resolve)));
      c.kill();
    }
  }
  await Promise.all(exits);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function writeLock(info) {
  fs.writeFileSync(lockPath, typeof info === 'string' ? info : JSON.stringify(info));
}

function listen(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    servers.push(s);
    s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
  });
}

const json = (body, status = 200) => (req, res) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// Processo vivo qualquer (representa o programa que reaproveitou o PID).
function sleeper() {
  const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  children.push(c);
  return c;
}

// PID de um processo que já terminou.
async function deadPid() {
  const c = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore', windowsHide: true });
  await new Promise((resolve) => c.once('exit', resolve));
  return c.pid;
}

describe('probeSkinsManager com servidor HTTP real', () => {
  test('Skins Manager respondendo: true', async () => {
    const { port } = await listen(json({ success: true, data: { status: 'ok', app: 'skins-manager' } }));
    expect(await probeSkinsManager({ port })).toBe(true);
  });

  test('200 de outro app (sem o campo app, app diferente, JSON inválido, corpo vazio): false', async () => {
    for (const body of [{ ok: true }, { data: { app: 'outro' } }, { data: null }, 'isto não é json', '', 'null']) {
      const { port } = await listen(json(body));
      expect(await probeSkinsManager({ port })).toBe(false);
    }
  });

  test('status diferente de 200 (404 e 500), mesmo com o corpo certo: false', async () => {
    for (const status of [404, 500]) {
      const { port } = await listen(json({ data: { app: 'skins-manager' } }, status));
      expect(await probeSkinsManager({ port })).toBe(false);
    }
  });

  test('porta sem ninguém ouvindo: false (rápido)', async () => {
    const port = await freePort();
    const t0 = Date.now();
    expect(await probeSkinsManager({ port })).toBe(false);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  test('servidor que nunca responde: o timeout encerra a sondagem com false', async () => {
    const { port } = await listen(() => {
      /* nunca responde */
    });
    const t0 = Date.now();
    expect(await probeSkinsManager({ port }, { timeoutMs: 150 })).toBe(false);
    expect(Date.now() - t0).toBeLessThan(2500);
  });

  test('o timeout padrão é curto (<= 2 s): servidor mudo não trava a inicialização', async () => {
    const { port } = await listen(() => {});
    const t0 = Date.now();
    expect(await probeSkinsManager({ port })).toBe(false);
    expect(Date.now() - t0).toBeLessThan(2500);
  });

  test('portas inválidas ou info ausente: false sem sequer chamar fetch', async () => {
    const fetchFn = jest.fn();
    for (const info of [null, undefined, {}, { port: 0 }, { port: -1 }, { port: 65536 }, { port: '3001' }, { port: 3001.5 }, { port: null }]) {
      expect(await probeSkinsManager(info, { fetchFn })).toBe(false);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('resposta sem ok / undefined do fetch: false', async () => {
    expect(await probeSkinsManager({ port: 3001 }, { fetchFn: async () => undefined })).toBe(false);
    expect(await probeSkinsManager({ port: 3001 }, { fetchFn: async () => ({ ok: true, json: async () => { throw new Error('x'); } }) })).toBe(false);
  });

  test('só consulta 127.0.0.1, nunca localhost nem outro host, mesmo que a trava traga um host', async () => {
    const fetchFn = jest.fn(async () => ({ ok: true, json: async () => ({ data: { app: 'skins-manager' } }) }));
    await probeSkinsManager({ port: 3055, host: 'evil.example.com', url: 'http://evil.example.com' }, { fetchFn });
    expect(fetchFn.mock.calls[0][0]).toBe('http://127.0.0.1:3055/api/health');
  });
});

describe('removeStaleLockByProbe: limites e casos de borda', () => {
  const probeFalse = () => jest.fn(async () => false);

  test('idade exatamente 30 s já é sondada; 29,999 s não', async () => {
    const edge = new Date(NOW.getTime() - STARTUP_GRACE_MS).toISOString();
    writeLock({ pid: 4242, port: 3001, startedAt: edge });
    const probe = probeFalse();
    expect(await removeStaleLockByProbe(tmp, { isAlive: () => true, probe, now: NOW, pid: 99 })).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(lockPath)).toBe(false);

    writeLock({ pid: 4242, port: 3001, startedAt: new Date(NOW.getTime() - STARTUP_GRACE_MS + 1).toISOString() });
    const probe2 = probeFalse();
    expect(await removeStaleLockByProbe(tmp, { isAlive: () => true, probe: probe2, now: NOW, pid: 99 })).toBe(false);
    expect(probe2).not.toHaveBeenCalled();
  });

  test('startedAt no futuro (relógio voltou): sonda em vez de proteger a trava', async () => {
    writeLock({ pid: 4242, port: 3001, startedAt: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString() });
    const probe = probeFalse();
    expect(await removeStaleLockByProbe(tmp, { isAlive: () => true, probe, now: NOW, pid: 99 })).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  test('startedAt ausente ou inválido: sonda (não dá para provar que é recente)', async () => {
    for (const startedAt of [undefined, 'ontem', 123, null]) {
      writeLock({ pid: 4242, port: 3001, startedAt });
      const probe = probeFalse();
      expect(await removeStaleLockByProbe(tmp, { isAlive: () => true, probe, now: NOW, pid: 99 })).toBe(true);
      expect(probe).toHaveBeenCalledTimes(1);
    }
  });

  test('trava sem porta (PID vivo, mais de 30 s): a sondagem falha e a trava é considerada velha', async () => {
    writeLock({ pid: 4242, mode: 'browser', startedAt: OLD });
    const lock = await acquireLockVerified(tmp, { pid: 99, now: NOW, isAlive: () => true });
    expect(JSON.parse(fs.readFileSync(lock.lockPath, 'utf8')).pid).toBe(99);
  });

  test('trava sem porta e recente (< 30 s): continua travada', async () => {
    writeLock({ pid: 4242, mode: 'browser', startedAt: new Date(NOW.getTime() - 1000).toISOString() });
    await expect(acquireLockVerified(tmp, { pid: 99, now: NOW, isAlive: () => true })).rejects.toMatchObject({ code: 'DATA_DIR_LOCKED' });
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid).toBe(4242);
  });

  test('JSON inválido, array, null, pid ausente/ruim: nunca sonda; o acquireLock trata como velha', async () => {
    for (const content of ['{quebrado', '[]', 'null', '{"port":3001}', '{"pid":"7"}', '{"pid":-3}', '{"pid":1.5}', '']) {
      writeLock(content);
      const probe = probeFalse();
      expect(await removeStaleLockByProbe(tmp, { isAlive: () => true, probe, now: NOW, pid: 99 })).toBe(false);
      expect(probe).not.toHaveBeenCalled();
      const lock = await acquireLockVerified(tmp, { pid: 99, now: NOW, isAlive: () => true });
      expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid).toBe(99);
      lock.release();
    }
  });

  test('trava com o próprio PID não é removida pela sondagem', async () => {
    writeLock({ pid: 99, port: 3001, startedAt: OLD });
    const probe = probeFalse();
    expect(await removeStaleLockByProbe(tmp, { isAlive: () => true, probe, now: NOW, pid: 99 })).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  test('a sondagem que lança exceção (probe quebrado) propaga: não remove a trava', async () => {
    writeLock({ pid: 4242, port: 3001, startedAt: OLD });
    await expect(
      removeStaleLockByProbe(tmp, { isAlive: () => true, probe: async () => { throw new Error('boom'); }, now: NOW, pid: 99 })
    ).rejects.toThrow('boom');
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  test('PID realmente vivo + servidor de outro app (200 sem app) numa porta real: trava velha', async () => {
    const other = sleeper();
    const { port } = await listen(json({ hello: 'world' }));
    writeLock({ pid: other.pid, port, mode: 'desktop', startedAt: OLD });
    const lock = await acquireLockVerified(tmp, { pid: 99, now: NOW });
    expect(JSON.parse(fs.readFileSync(lock.lockPath, 'utf8')).pid).toBe(99);
  });

  test('PID realmente vivo + Skins Manager real na porta: recusa com DATA_DIR_LOCKED e preserva a trava', async () => {
    const other = sleeper();
    const { port } = await listen(json({ success: true, data: { app: 'skins-manager' } }));
    writeLock({ pid: other.pid, port, mode: 'desktop', startedAt: OLD });
    await expect(acquireLockVerified(tmp, { pid: 99, now: NOW })).rejects.toMatchObject({
      status: 409,
      code: 'DATA_DIR_LOCKED',
      message: 'O Skins Manager já está aberto pelo app desktop.',
    });
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid).toBe(other.pid);
  });

  test('PID realmente morto (queda do backend do desktop), mesmo recente (< 30 s): retomada imediata, sem sondar', async () => {
    // É o que o supervisor encontra ao reiniciar o backend depois de um crash: o processo antigo morreu
    // sem liberar a trava e o novo tem outro PID.
    const pid = await deadPid();
    writeLock({ pid, port: 3001, mode: 'desktop', startedAt: new Date().toISOString() });
    const probe = jest.fn(async () => true);
    const lock = await acquireLockVerified(tmp, { pid: 99, probe });
    expect(probe).not.toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(lock.lockPath, 'utf8')).pid).toBe(99);
  });

  test('o release do novo dono só remove a trava dele', async () => {
    writeLock({ pid: await deadPid(), port: 3001, startedAt: OLD });
    const lock = await acquireLockVerified(tmp, { pid: 99, now: NOW });
    writeLock({ pid: 123, port: 1 }); // outro processo assumiu depois
    lock.release();
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid).toBe(123);
  });
});

describe('server.js real (processo filho): PID reaproveitado e trava com sondagem', () => {
  let dbDir;

  function startServer(port, { env = {} } = {}) {
    const child = spawn(process.execPath, ['-r', REDIRECT, SERVER], {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        PORT: String(port),
        DB_PATH: path.join(dbDir, 'inventory.sqlite'),
        SM_TEST_LEGACY_DIR: path.join(tmp, 'legacy'),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    children.push(child);
    const out = { stdout: '', stderr: '', child };
    child.stdout.on('data', (c) => { out.stdout += c; });
    child.stderr.on('data', (c) => { out.stderr += c; });
    out.exit = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    return out;
  }

  async function waitUp(port, proc) {
    for (let i = 0; i < 120; i += 1) {
      if (proc.child.exitCode !== null) throw new Error(`servidor saiu (${proc.child.exitCode}): ${proc.stderr}`);
      const ok = await probeSkinsManager({ port });
      if (ok) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('servidor não subiu');
  }

  beforeEach(() => {
    dbDir = path.join(tmp, 'data');
    fs.mkdirSync(dbDir);
  });

  test('PID vivo de outro programa + porta que não responde, trava antiga: o servidor assume a trava e sobe', async () => {
    const other = sleeper();
    const deadPort = await freePort();
    fs.writeFileSync(path.join(dbDir, LOCK_FILE_NAME), JSON.stringify({ pid: other.pid, port: deadPort, mode: 'desktop', startedAt: OLD }));
    const port = await freePort();
    const p = startServer(port);
    await waitUp(port, p);
    expect(JSON.parse(fs.readFileSync(path.join(dbDir, LOCK_FILE_NAME), 'utf8'))).toMatchObject({ pid: p.child.pid, port, mode: 'browser' });
  });

  test('PID vivo + outro app respondendo 200 na porta da trava: o servidor assume a trava e sobe', async () => {
    const other = sleeper();
    const { port: otherPort } = await listen(json({ status: 'ok' }));
    fs.writeFileSync(path.join(dbDir, LOCK_FILE_NAME), JSON.stringify({ pid: other.pid, port: otherPort, startedAt: OLD }));
    const port = await freePort();
    const p = startServer(port);
    await waitUp(port, p);
    expect(JSON.parse(fs.readFileSync(path.join(dbDir, LOCK_FILE_NAME), 'utf8')).pid).toBe(p.child.pid);
  });

  test('PID vivo + Skins Manager respondendo, trava antiga: sai com 1 e DATA_DIR_LOCKED, sem criar o banco', async () => {
    const other = sleeper();
    const { port: smPort } = await listen(json({ data: { app: 'skins-manager' } }));
    fs.writeFileSync(path.join(dbDir, LOCK_FILE_NAME), JSON.stringify({ pid: other.pid, port: smPort, mode: 'desktop', startedAt: OLD }));
    const p = startServer(await freePort());
    expect(await p.exit).toBe(1);
    expect(p.stderr).toContain('app desktop');
    expect(p.stderr).not.toMatch(/\n\s+at /);
    expect(p.stdout).not.toContain('[order]');
    expect(fs.existsSync(path.join(dbDir, 'inventory.sqlite'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(dbDir, LOCK_FILE_NAME), 'utf8')).pid).toBe(other.pid);
  });

  test('PID vivo, porta morta mas trava recente (< 30 s): não sonda e recusa (instância ainda subindo)', async () => {
    const other = sleeper();
    const deadPort = await freePort();
    fs.writeFileSync(path.join(dbDir, LOCK_FILE_NAME), JSON.stringify({ pid: other.pid, port: deadPort, mode: 'browser', startedAt: new Date().toISOString() }));
    const p = startServer(await freePort());
    expect(await p.exit).toBe(1);
    expect(p.stderr).toContain('start-app.bat');
    expect(fs.existsSync(path.join(dbDir, 'inventory.sqlite'))).toBe(false);
  });

  test('duas instâncias disputando ao mesmo tempo: só uma sobe, a outra sai com 1', async () => {
    const portA = await freePort();
    const portB = await freePort();
    const a = startServer(portA);
    const b = startServer(portB);
    const results = await Promise.race([
      Promise.all([a.exit, b.exit]).then(() => 'both-exited'),
      (async () => {
        // espera uma delas cair
        for (let i = 0; i < 200; i += 1) {
          if (a.child.exitCode !== null || b.child.exitCode !== null) return 'one-exited';
          await new Promise((r) => setTimeout(r, 100));
        }
        return 'timeout';
      })(),
    ]);
    expect(results).not.toBe('timeout');
    const survivor = a.child.exitCode === null ? a : b;
    const loser = survivor === a ? b : a;
    expect(await loser.exit).toBe(1);
    expect(loser.stderr).toContain('Não foi possível iniciar o Skins Manager');
    expect(JSON.parse(fs.readFileSync(path.join(dbDir, LOCK_FILE_NAME), 'utf8')).pid).toBe(survivor.child.pid);
  });

  test(':memory: não cria trava nem sonda nada', async () => {
    const port = await freePort();
    const p = startServer(port, { env: { DB_PATH: ':memory:' } });
    await waitUp(port, p);
    expect(fs.readdirSync(dbDir)).toEqual([]);
  });
});
