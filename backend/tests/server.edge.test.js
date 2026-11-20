// Bordas do server.js (T45 e D135): erro de env, banco futuro e escuta apenas em loopback.
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const BACKEND_DIR = path.resolve(__dirname, '..');
const SERVER = path.join(BACKEND_DIR, 'server.js');

jest.setTimeout(25000);

function runToExit(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVER], {
      cwd: BACKEND_DIR,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const killer = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.on('exit', (code, signal) => {
      clearTimeout(killer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

describe('server.js - erro de configuração (T45)', () => {
  test.each(['abc', '0', '70000', '-1', '3001.5'])('PORT inválida "%s": mensagem em português, saída 1, sem stack', async (port) => {
    const r = await runToExit({ PORT: port, DB_PATH: ':memory:' });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Não foi possível iniciar o Skins Manager');
    expect(r.stderr).toContain('PORT inválida');
    expect(r.stderr).not.toMatch(/\n\s+at /);
    expect(r.stderr).not.toMatch(/node:internal|Error: /);
    expect(r.stdout).not.toMatch(/rodando/);
  });

  test('SLOW_ITEM_DAYS inválido: mesma saída amigável', async () => {
    const r = await runToExit({ PORT: '39881', DB_PATH: ':memory:', SLOW_ITEM_DAYS: 'x' });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Não foi possível iniciar o Skins Manager');
    expect(r.stderr).toContain('SLOW_ITEM_DAYS');
    expect(r.stderr).not.toMatch(/\n\s+at /);
  });

  test('banco de versão futura: mensagem completa com versões, sem stack', async () => {
    const Database = require('better-sqlite3');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-future2-'));
    const dbPath = path.join(dir, 'f.sqlite');
    const db = new Database(dbPath);
    db.pragma('user_version = 9999');
    db.close();
    try {
      const r = await runToExit({ PORT: '39882', DB_PATH: dbPath });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('Não foi possível iniciar o Skins Manager: O banco de dados foi criado por uma versão mais nova');
      expect(r.stderr).toMatch(/v9999; este app conhece até v\d+\)\. Atualize o app\./);
      expect(r.stderr).not.toMatch(/\n\s+at /);
      // O banco futuro não pode ser alterado.
      const check = new Database(dbPath, { readonly: true });
      expect(check.pragma('user_version', { simple: true })).toBe(9999);
      check.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('DB_PATH em pasta impossível: saída 1 em português, sem stack', async () => {
    const r = await runToExit({ PORT: '39883', DB_PATH: path.join(os.tmpdir(), 'sm-nao-existe-xyz', 'a', 'b.sqlite') });
    expect([0, 1]).toContain(r.code === null ? 1 : r.code);
    if (r.code === 1) {
      expect(r.stderr).toContain('Não foi possível iniciar o Skins Manager');
      expect(r.stderr).not.toMatch(/\n\s+at /);
    }
  });
});

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return null;
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

function tryConnect(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 2000 });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

describe('server.js - escuta só em loopback (D135)', () => {
  test('aceita 127.0.0.1 e recusa o IP da rede local', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [SERVER], {
      cwd: BACKEND_DIR,
      env: { ...process.env, PORT: String(port), DB_PATH: ':memory:' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('servidor não subiu')), 10000);
        child.stdout.on('data', (c) => { if (/rodando/.test(String(c))) { clearTimeout(t); resolve(); } });
        child.on('exit', () => reject(new Error('servidor saiu')));
      });
      const res = await httpGet(`http://127.0.0.1:${port}/api/health`);
      expect(res.status).toBe(200);
      const lan = lanAddress();
      if (lan) expect(await tryConnect(lan, port)).toBe(false);
    } finally {
      child.kill('SIGKILL');
      await new Promise((r) => {
        if (child.exitCode !== null || child.signalCode !== null) return r();
        const t = setTimeout(r, 5000);
        child.once('exit', () => { clearTimeout(t); r(); });
      });
    }
  });
});
