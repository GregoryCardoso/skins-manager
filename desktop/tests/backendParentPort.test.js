'use strict';

// backend/server.js no modo desktop (D177): mensagens ready/fatal/shutdown pelo process.parentPort simulado.
// Banco e trava em pasta temporária (DB_PATH explícito, porta livre); nunca o %APPDATA% real nem backend/data.
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require(path.resolve(__dirname, '..', '..', 'backend', 'node_modules', 'better-sqlite3'));

const BACKEND_DIR = path.resolve(__dirname, '..', '..', 'backend');
const SERVER = path.join(BACKEND_DIR, 'server.js');
const SHIM = path.join(__dirname, 'helpers', 'parentPortShim.js');

jest.setTimeout(40000);

let tmp;
const children = [];
const servers = [];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-desktop-'));
});

afterEach(async () => {
  const exits = [];
  while (children.length) {
    const c = children.pop();
    if (c.exitCode === null) {
      exits.push(new Promise((resolve) => c.once('exit', resolve)));
      c.kill();
    }
  }
  await Promise.all(exits);
  while (servers.length) await new Promise((resolve) => servers.pop().close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

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

function start({ port, dataDir, withParentPort = true }) {
  const args = withParentPort ? ['-r', SHIM, SERVER] : [SERVER];
  const child = spawn(process.execPath, args, {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(dataDir, 'inventory.sqlite'),
      SKINS_MANAGER_MODE: 'desktop',
      APPDATA: path.join(tmp, 'appdata-unused'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.push(child);
  const out = { child, stdout: '', stderr: '', messages: [], waiters: [] };
  child.stdout.on('data', (chunk) => {
    out.stdout += chunk;
    out.messages = out.stdout
      .split('\n')
      .filter((line) => line.startsWith('@@MSG '))
      .map((line) => JSON.parse(line.slice(6)));
    out.waiters.forEach((w) => w());
  });
  child.stderr.on('data', (chunk) => { out.stderr += chunk; });
  out.exit = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  out.waitFor = (type) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`sem mensagem ${type}; stdout=${out.stdout} stderr=${out.stderr}`)), 20000);
      const check = () => {
        const found = out.messages.find((m) => m.type === type);
        if (found) {
          clearTimeout(timer);
          resolve(found);
          return true;
        }
        return false;
      };
      if (!check()) out.waiters.push(check);
    });
  out.send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  return out;
}

describe('backend/server.js com process.parentPort', () => {
  test('ready com porta e versão; shutdown sai com 0 e libera a trava', async () => {
    const port = await freePort();
    const dataDir = path.join(tmp, 'data');
    const run = start({ port, dataDir });
    const ready = await run.waitFor('ready');
    expect(ready.port).toBe(port);
    expect(ready.version).toMatch(/^\d+\.\d+\.\d+/);
    const lockPath = path.join(dataDir, 'skins-manager.lock');
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(lock.mode).toBe('desktop');
    expect(lock.port).toBe(port);

    run.send({ type: 'shutdown' });
    expect(await run.exit).toBe(0);
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(run.messages.filter((m) => m.type === 'fatal')).toEqual([]);
  });

  test('DATA_DIR_LOCKED: a segunda instância na mesma pasta envia fatal e sai com 1', async () => {
    const dataDir = path.join(tmp, 'data');
    const first = start({ port: await freePort(), dataDir });
    await first.waitFor('ready');
    const second = start({ port: await freePort(), dataDir });
    const fatal = await second.waitFor('fatal');
    expect(fatal.code).toBe('DATA_DIR_LOCKED');
    expect(typeof fatal.message).toBe('string');
    expect(await second.exit).toBe(1);
    expect(second.messages.find((m) => m.type === 'ready')).toBeUndefined();
    expect(fs.existsSync(path.join(dataDir, 'skins-manager.lock'))).toBe(true);
  });

  test('DB_NEWER_VERSION: banco de versão futura envia fatal e libera a trava', async () => {
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const db = new Database(path.join(dataDir, 'inventory.sqlite'));
    db.pragma('user_version = 9999');
    db.close();
    const run = start({ port: await freePort(), dataDir });
    const fatal = await run.waitFor('fatal');
    expect(fatal.code).toBe('DB_NEWER_VERSION');
    expect(await run.exit).toBe(1);
    expect(fs.existsSync(path.join(dataDir, 'skins-manager.lock'))).toBe(false);
  });

  test('PORT_IN_USE: porta ocupada envia fatal e libera a trava', async () => {
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    servers.push(blocker);
    const dataDir = path.join(tmp, 'data');
    const run = start({ port: blocker.address().port, dataDir });
    const fatal = await run.waitFor('fatal');
    expect(fatal.code).toBe('PORT_IN_USE');
    expect(await run.exit).toBe(1);
    expect(fs.existsSync(path.join(dataDir, 'skins-manager.lock'))).toBe(false);
    expect(run.messages.find((m) => m.type === 'ready')).toBeUndefined();
  });

  test('sem parentPort: nenhuma mensagem e o mesmo log de início de antes', async () => {
    const port = await freePort();
    const run = start({ port, dataDir: path.join(tmp, 'data'), withParentPort: false });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`sem log de início: ${run.stdout} ${run.stderr}`)), 20000);
      run.child.stdout.on('data', () => {
        if (run.stdout.includes('rodando em')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    expect(run.stdout).not.toContain('@@MSG');
    expect(run.stdout).toContain(`http://localhost:${port}`);
  });

  test('sem parentPort e porta ocupada: sai com 1 e escreve a mensagem em português', async () => {
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    servers.push(blocker);
    const run = start({ port: blocker.address().port, dataDir: path.join(tmp, 'data'), withParentPort: false });
    expect(await run.exit).toBe(1);
    expect(run.stderr).toContain('já está em uso');
  });
});
