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
    server.listen(port, () => resolve(server.address().port));
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
