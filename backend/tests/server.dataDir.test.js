// 7.2 - inicialização do server.js: trava -> migração -> banco -> listen, liberação da trava em erro,
// segunda instância e :memory:. Sobe server.js como processo filho em porta livre (nunca a 3001 real),
// com APPDATA temporário e a pasta legada redirecionada (helpers/redirectLegacyDir.js).
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const BACKEND_DIR = path.resolve(__dirname, '..');
const SERVER = path.join(BACKEND_DIR, 'server.js');
const REDIRECT = path.join(__dirname, 'helpers', 'redirectLegacyDir.js');

jest.setTimeout(40000);

let tmp;
let appData;
let legacyDir;
let dataDir;
const children = [];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-init-'));
  appData = path.join(tmp, 'roaming');
  legacyDir = path.join(tmp, 'legacy');
  dataDir = path.join(appData, 'SkinsManager');
  fs.mkdirSync(appData);
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

function makeLegacy() {
  fs.mkdirSync(path.join(legacyDir, 'backups'), { recursive: true });
  const db = new Database(path.join(legacyDir, 'inventory.sqlite'));
  db.exec("CREATE TABLE legado (v TEXT); INSERT INTO legado VALUES ('veio-do-legado');");
  db.close();
  fs.writeFileSync(path.join(legacyDir, 'backups', 'old.sqlite'), 'b');
}

function start(port, { env = {}, preload = true } = {}) {
  const args = preload ? ['-r', REDIRECT, SERVER] : [SERVER];
  const child = spawn(process.execPath, args, {
    cwd: BACKEND_DIR,
    env: { ...process.env, PORT: String(port), APPDATA: appData, DB_PATH: '', SM_TEST_LEGACY_DIR: legacyDir, ...env },
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

function health(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health' }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(res.statusCode === 200 ? JSON.parse(body) : null));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(1000, () => { req.destroy(); resolve(null); });
  });
}

async function waitUp(port, proc) {
  for (let i = 0; i < 100; i += 1) {
    if (proc.child.exitCode !== null) throw new Error(`servidor saiu (${proc.child.exitCode}): ${proc.stderr}`);
    const h = await health(port);
    if (h) return h;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('servidor não subiu');
}

describe('server.js - pasta de dados (7.2)', () => {
  test('ordem: trava -> migração -> banco -> listen; dados migrados; health traz app e version', async () => {
    makeLegacy();
    const port = await freePort();
    const p = start(port);
    const h = await waitUp(port, p);
    expect(h.data).toMatchObject({ status: 'ok', app: 'skins-manager', version: expect.any(String) });

    const lines = p.stdout.split(/\r?\n/).filter((l) => l.startsWith('[order]'));
    expect(lines[0]).toBe('[order] migration lock=true dbExists=false'); // trava antes, banco ainda não existe
    expect(lines[1]).toBe('[order] getDb'); // banco depois da migração

    const lock = JSON.parse(fs.readFileSync(path.join(dataDir, 'skins-manager.lock'), 'utf8'));
    expect(lock).toMatchObject({ pid: p.child.pid, port, mode: 'browser' });

    const db = new Database(path.join(dataDir, 'inventory.sqlite'), { readonly: true });
    expect(db.prepare('SELECT v FROM legado').get().v).toBe('veio-do-legado'); // migrou e as migrações do app rodaram por cima
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThan(0);
    db.close();
    expect(fs.existsSync(path.join(dataDir, 'backups', 'old.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(legacyDir, 'LEIA-ME-DADOS-MOVIDOS.txt'))).toBe(true);
  });

  test('modo desktop gravado na trava (SKINS_MANAGER_MODE=desktop) e segunda instância recebe a mensagem do desktop', async () => {
    const port = await freePort();
    const first = start(port, { env: { SKINS_MANAGER_MODE: 'desktop' } });
    await waitUp(port, first);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'skins-manager.lock'), 'utf8')).mode).toBe('desktop');

    const second = start(await freePort());
    expect(await second.exit).toBe(1);
    expect(second.stderr).toContain('Não foi possível iniciar o Skins Manager');
    expect(second.stderr).toContain('app desktop');
    expect(second.stderr).not.toMatch(/\n\s+at /);
    // a primeira segue de pé e com a trava
    expect(await health(port)).not.toBeNull();
    expect(fs.existsSync(path.join(dataDir, 'skins-manager.lock'))).toBe(true);
  });

  test('segunda instância em modo browser: mensagem com a porta da primeira; não migra nem cria banco', async () => {
    makeLegacy();
    fs.mkdirSync(dataDir, { recursive: true });
    // pid vivo (o do jest) e uma porta que responde como Skins Manager. Sem startedAt a trava é sondada (D173):
    // por isso a porta é de um servidor falso nosso, nunca a 3001 (que pode ter o app real aberto na máquina).
    const fake = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, data: { status: 'ok', app: 'skins-manager' } }));
    });
    await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
    const fakePort = fake.address().port;
    fs.writeFileSync(path.join(dataDir, 'skins-manager.lock'), JSON.stringify({ pid: process.pid, port: fakePort, mode: 'browser' }));
    const r = start(await freePort());
    const exitCode = await r.exit;
    await new Promise((resolve) => fake.close(resolve));
    expect(exitCode).toBe(1);
    expect(r.stderr).toContain(`start-app.bat em http://localhost:${fakePort}`);
    expect(r.stdout).not.toContain('[order]'); // nem chegou à migração
    expect(fs.existsSync(path.join(dataDir, 'inventory.sqlite'))).toBe(false);
    expect(fs.existsSync(path.join(legacyDir, 'LEIA-ME-DADOS-MOVIDOS.txt'))).toBe(false);
    // a trava alheia fica intacta
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'skins-manager.lock'), 'utf8')).pid).toBe(process.pid);
  });

  test('trava órfã (pid morto) com DB_PATH explícito: servidor sobe, assume a trava', async () => {
    const explicitDir = path.join(tmp, 'explicit');
    fs.mkdirSync(explicitDir);
    fs.writeFileSync(path.join(explicitDir, 'skins-manager.lock'), JSON.stringify({ pid: 2 ** 22 + 999, port: 3001 }));
    const port = await freePort();
    const p = start(port, { preload: false, env: { DB_PATH: path.join(explicitDir, 'x.sqlite') } });
    await waitUp(port, p);
    expect(JSON.parse(fs.readFileSync(path.join(explicitDir, 'skins-manager.lock'), 'utf8')).pid).toBe(p.child.pid);
    expect(fs.existsSync(path.join(explicitDir, 'x.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(appData, 'SkinsManager'))).toBe(false); // DB_PATH explícito não usa a pasta padrão
  });

  test('erro de inicialização (banco de versão futura) libera a trava e sai com 1', async () => {
    const explicitDir = path.join(tmp, 'explicit');
    fs.mkdirSync(explicitDir);
    const dbFile = path.join(explicitDir, 'f.sqlite');
    const f = new Database(dbFile);
    f.pragma('user_version = 9999');
    f.close();
    const r = start(await freePort(), { preload: false, env: { DB_PATH: dbFile } });
    expect(await r.exit).toBe(1);
    expect(r.stderr).toContain('Não foi possível iniciar o Skins Manager');
    expect(fs.existsSync(path.join(explicitDir, 'skins-manager.lock'))).toBe(false);
  });

  test('legado corrompido: sai com 1, sem destino, trava liberada e original intacto', async () => {
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'inventory.sqlite'), 'isto nao e um sqlite');
    const r = start(await freePort());
    expect(await r.exit).toBe(1);
    expect(r.stderr).toContain('Não foi possível copiar seus dados');
    expect(fs.existsSync(path.join(dataDir, 'inventory.sqlite'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'skins-manager.lock'))).toBe(false);
    expect(fs.readFileSync(path.join(legacyDir, 'inventory.sqlite'), 'utf8')).toBe('isto nao e um sqlite');
  });

  test('porta em uso (EADDRINUSE) libera a trava', async () => {
    const blocker = net.createServer();
    const port = await new Promise((resolve) => blocker.listen(0, '127.0.0.1', () => resolve(blocker.address().port)));
    try {
      const r = start(port);
      expect(await r.exit).toBe(1);
      expect(r.stderr).toContain(`A porta ${port} já está em uso`);
      expect(fs.existsSync(path.join(dataDir, 'skins-manager.lock'))).toBe(false);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  test(':memory: não cria trava nem pasta de dados', async () => {
    const port = await freePort();
    const p = start(port, { preload: false, env: { DB_PATH: ':memory:' } });
    await waitUp(port, p);
    expect(fs.readdirSync(appData)).toEqual([]);
    expect(fs.existsSync(path.join(BACKEND_DIR, 'data', 'skins-manager.lock'))).toBe(false);
  });
});
