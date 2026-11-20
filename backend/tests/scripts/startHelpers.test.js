const fs = require('fs');
const os = require('os');
const path = require('path');
const { needsBuild, isAppRunning, waitForHealth } = require('../../../scripts/startHelpers');

describe('needsBuild', () => {
  let frontendDir;
  beforeEach(() => {
    frontendDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-fe-'));
    fs.mkdirSync(path.join(frontendDir, 'src'));
    fs.writeFileSync(path.join(frontendDir, 'src', 'page.tsx'), 'x');
  });
  afterEach(() => fs.rmSync(frontendDir, { recursive: true, force: true }));

  function writeOut(mtimeSec) {
    fs.mkdirSync(path.join(frontendDir, 'out'), { recursive: true });
    const file = path.join(frontendDir, 'out', 'index.html');
    fs.writeFileSync(file, '<html></html>');
    fs.utimesSync(file, mtimeSec, mtimeSec);
  }

  test('sem out: precisa compilar', () => {
    expect(needsBuild({ frontendDir })).toBe(true);
  });

  test('out mais velho que o código: precisa compilar', () => {
    fs.utimesSync(path.join(frontendDir, 'src', 'page.tsx'), 2000, 2000);
    writeOut(1000);
    expect(needsBuild({ frontendDir })).toBe(true);
  });

  test('out atualizado: não precisa', () => {
    fs.utimesSync(path.join(frontendDir, 'src', 'page.tsx'), 1000, 1000);
    fs.utimesSync(path.join(frontendDir, 'src'), 1000, 1000);
    writeOut(2000);
    expect(needsBuild({ frontendDir })).toBe(false);
  });
});

describe('isAppRunning', () => {
  test('true quando /api/health responde ok', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true });
    expect(await isAppRunning({ port: 3001, fetchFn })).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toBe('http://127.0.0.1:3001/api/health');
  });

  test('false em erro de rede ou status ruim', async () => {
    expect(await isAppRunning({ port: 3001, fetchFn: jest.fn().mockRejectedValue(new Error('x')) })).toBe(false);
    expect(await isAppRunning({ port: 3001, fetchFn: jest.fn().mockResolvedValue({ ok: false }) })).toBe(false);
  });
});

describe('waitForHealth', () => {
  function clock() {
    let t = 0;
    return { now: () => t, sleep: async (ms) => { t += ms; } };
  }

  test('sucesso depois de algumas tentativas', async () => {
    const fetchFn = jest.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ ok: true });
    expect(await waitForHealth({ port: 1, fetchFn, ...clock() })).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  test('timeout devolve false', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false });
    expect(await waitForHealth({ port: 1, fetchFn, timeoutMs: 2000, intervalMs: 500, ...clock() })).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  test('erro de rede contínuo não lança', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('down'));
    await expect(waitForHealth({ port: 1, fetchFn, timeoutMs: 1000, ...clock() })).resolves.toBe(false);
  });
});
