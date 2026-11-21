// QA da revisão da Etapa 7: scripts/startHelpers.js rodado de verdade pela linha de comando, como o start-app.bat faz.
// Usa APPDATA/USERPROFILE temporários e portas livres: nunca toca a pasta de dados nem a porta 3001 reais.
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'startHelpers.js');
jest.setTimeout(30000);

let tmp;
const servers = [];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-cli-'));
});
afterEach(async () => {
  while (servers.length) {
    const s = servers.pop();
    s.closeAllConnections?.();
    await new Promise((resolve) => s.close(resolve));
  }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function cleanEnv(extra) {
  const env = { ...process.env, ...extra };
  delete env.DB_PATH;
  if (!('PORT' in (extra || {}))) delete env.PORT;
  return env;
}

// assíncrono (o servidor falso vive neste processo e não pode ser bloqueado por spawnSync)
function runAsync(command, extra) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, command], { env: cleanEnv(extra), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('exit', (code) => resolve({ status: code, stderr }));
  });
}

function listen(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    servers.push(s);
    s.listen(0, '127.0.0.1', () => resolve(s.address().port));
  });
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function writeLock(appData, content) {
  const dir = path.join(appData, 'SkinsManager');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'skins-manager.lock'), typeof content === 'string' ? content : JSON.stringify(content));
}

describe('startHelpers.js desktop-lock (CLI)', () => {
  const run = (env) => spawnSync(process.execPath, [SCRIPT, 'desktop-lock'], { env: cleanEnv(env), encoding: 'utf8', windowsHide: true });

  test('trava do app desktop em %APPDATA%\SkinsManager: exit 0', () => {
    writeLock(tmp, { pid: 1, port: 3001, mode: 'desktop' });
    expect(run({ APPDATA: tmp }).status).toBe(0);
  });

  test('trava do modo navegador: exit 1', () => {
    writeLock(tmp, { pid: 1, port: 3001, mode: 'browser' });
    expect(run({ APPDATA: tmp }).status).toBe(1);
  });

  test('trava sem o campo mode (versão antiga): exit 1', () => {
    writeLock(tmp, { pid: 1, port: 3001 });
    expect(run({ APPDATA: tmp }).status).toBe(1);
  });

  test('trava corrompida (lixo, vazia, null, array): exit 1 sem stack trace', () => {
    for (const content of ['lixo{', '', 'null', '[]', '"desktop"']) {
      writeLock(tmp, content);
      const r = run({ APPDATA: tmp });
      expect(r.status).toBe(1);
      expect(r.stderr).toBe('');
    }
  });

  test('sem trava e sem a pasta SkinsManager: exit 1', () => {
    expect(run({ APPDATA: tmp }).status).toBe(1);
  });

  test('sem APPDATA: cai em <perfil>\AppData\Roaming\SkinsManager (mesma regra do backend)', () => {
    if (process.platform !== 'win32') return;
    const profile = path.join(tmp, 'profile');
    writeLock(path.join(profile, 'AppData', 'Roaming'), { pid: 1, mode: 'desktop' });
    expect(run({ APPDATA: '', USERPROFILE: profile, HOME: profile }).status).toBe(0);
  });

  test('DB_PATH explícito: a pasta da trava acompanha o banco (mesma pasta onde o backend grava)', () => {
    const dir = path.join(tmp, 'custom');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'skins-manager.lock'), JSON.stringify({ pid: 1, mode: 'desktop' }));
    const r = spawnSync(process.execPath, [SCRIPT, 'desktop-lock'], {
      env: { ...process.env, DB_PATH: path.join(dir, 'x.sqlite'), APPDATA: path.join(tmp, 'vazio') },
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(r.status).toBe(0);
  });
});

describe('startHelpers.js running (CLI)', () => {
  test('Skins Manager respondendo na PORT: exit 0', async () => {
    const port = await listen((req, res) => res.end(JSON.stringify({ success: true, data: { status: 'ok', app: 'skins-manager' } })));
    expect((await runAsync('running', { PORT: String(port) })).status).toBe(0);
  });

  test('outro programa respondendo 200 na PORT: exit 1 (o .bat não abre o navegador num app alheio)', async () => {
    const port = await listen((req, res) => res.end(JSON.stringify({ status: 'ok' })));
    expect((await runAsync('running', { PORT: String(port) })).status).toBe(1);
  });

  test('ninguém na PORT: exit 1', async () => {
    expect((await runAsync('running', { PORT: String(await freePort()) })).status).toBe(1);
  });

  test('comando desconhecido ou ausente: exit 2 com uso na stderr', async () => {
    const r = await runAsync('banana');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('desktop-lock');
  });
});
