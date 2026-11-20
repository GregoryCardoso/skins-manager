// O servidor escuta só em 127.0.0.1 (D135), então os bloqueadores também.
// Sobe server.js como processo filho com a porta já ocupada e confere a saída amigável.
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const BACKEND_DIR = path.resolve(__dirname, '..');
const SERVER = path.join(BACKEND_DIR, 'server.js');
const SPY = path.join(__dirname, 'helpers', 'spyCloseDb.js');

jest.setTimeout(20000);

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => (server.listening ? server.close(() => resolve()) : resolve()));
}

function runServer(port, extraArgs = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...extraArgs, SERVER], {
      cwd: BACKEND_DIR,
      env: { ...process.env, PORT: String(port), DB_PATH: ':memory:' },
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
      resolve({ code, signal, stdout, stderr, child });
    });
  });
}

describe('server.js - porta em uso (EADDRINUSE)', () => {
  let blocker;
  let port;

  beforeEach(async () => {
    blocker = net.createServer();
    port = await listen(blocker, 0);
  });

  afterEach(async () => {
    await close(blocker);
  });

  test('imprime mensagem amigável em português e sai com código 1', async () => {
    const result = await runServer(port);
    expect(result.signal).toBeNull();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`A porta ${port} já está em uso`);
    expect(result.stderr).toMatch(/altere PORT no backend\/\.env/);
    // Sem stack trace cru na saída.
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });

  test('não anuncia "rodando" quando o listen falhou', async () => {
    // Express 5 também chama o callback do app.listen com o erro (server.once('error', done)).
    const result = await runServer(port);
    expect(result.code).toBe(1);
    expect(result.stdout).not.toMatch(/rodando/);
  });

  test('chama closeDb() antes de sair', async () => {
    const result = await runServer(port, ['-r', SPY]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('[spy] closeDb chamado');
    expect(result.stderr).toContain(`A porta ${port} já está em uso`);
  });

  test('a porta é liberada depois: processo filho não ficou escutando', async () => {
    const result = await runServer(port);
    expect(result.code).toBe(1);
    expect(result.child.exitCode).toBe(1);
    await close(blocker);
    const probe = net.createServer();
    await expect(listen(probe, port)).resolves.toBe(port);
    await close(probe);
  });
});

describe('server.js - banco de versão futura (T45)', () => {
  const fs = require('fs');
  const os = require('os');
  const Database = require('better-sqlite3');

  test('mensagem em português, sem stack, código 1', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-future-'));
    const dbPath = path.join(dir, 'future.sqlite');
    const db = new Database(dbPath);
    db.pragma('user_version = 9999');
    db.close();
    try {
      const result = await new Promise((resolve) => {
        const child = spawn(process.execPath, [SERVER], {
          cwd: BACKEND_DIR,
          env: { ...process.env, PORT: '3999', DB_PATH: dbPath },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        let stderr = '';
        child.stderr.on('data', (c) => { stderr += c; });
        child.on('exit', (code) => resolve({ code, stderr }));
      });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('versão mais nova do Skins Manager (v9999;');
      expect(result.stderr).not.toMatch(/\n\s+at /);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('server.js - escuta só em 127.0.0.1 (D135)', () => {
  test('ocupar 127.0.0.1:porta basta para dar EADDRINUSE', async () => {
    const blocker = net.createServer();
    const port = await new Promise((resolve) => blocker.listen(0, '127.0.0.1', () => resolve(blocker.address().port)));
    try {
      const result = await runServer(port);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`A porta ${port} já está em uso`);
    } finally {
      await close(blocker);
    }
  });
});
