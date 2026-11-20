const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { needsBuild, isAppRunning, waitForHealth, healthUrl } = require('../../../scripts/startHelpers');

describe('needsBuild - bordas', () => {
  let fe;
  beforeEach(() => {
    fe = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-fe2-'));
    fs.mkdirSync(path.join(fe, 'src', 'deep', 'er'), { recursive: true });
    fs.mkdirSync(path.join(fe, 'public'));
    fs.writeFileSync(path.join(fe, 'src', 'deep', 'er', 'a.ts'), 'x');
    fs.writeFileSync(path.join(fe, 'public', 'p.svg'), 'x');
    fs.writeFileSync(path.join(fe, 'next.config.ts'), 'x');
    fs.writeFileSync(path.join(fe, 'package.json'), '{}');
    fs.writeFileSync(path.join(fe, 'tsconfig.json'), '{}');
  });
  afterEach(() => fs.rmSync(fe, { recursive: true, force: true }));

  const touchAll = (sec) => {
    const walk = (p) => {
      if (!fs.existsSync(p)) return;
      if (fs.statSync(p).isDirectory()) fs.readdirSync(p).forEach((n) => walk(path.join(p, n)));
      fs.utimesSync(p, sec, sec);
    };
    ['src', 'public', 'next.config.ts', 'package.json', 'tsconfig.json'].forEach((n) => walk(path.join(fe, n)));
  };
  const writeOut = (sec) => {
    fs.mkdirSync(path.join(fe, 'out'), { recursive: true });
    const f = path.join(fe, 'out', 'index.html');
    fs.writeFileSync(f, 'x');
    fs.utimesSync(f, sec, sec);
  };

  test('tudo mais velho que o out: em dia', () => {
    touchAll(1000);
    writeOut(2000);
    expect(needsBuild({ frontendDir: fe })).toBe(false);
  });

  test.each([
    ['src/deep/er/a.ts'],
    ['public/p.svg'],
    ['next.config.ts'],
    ['package.json'],
    ['tsconfig.json'],
  ])('%s mais novo exige build', (rel) => {
    touchAll(1000);
    writeOut(2000);
    fs.utimesSync(path.join(fe, rel), 3000, 3000);
    expect(needsBuild({ frontendDir: fe })).toBe(true);
  });

  test('arquivo novo adicionado em src exige build', () => {
    touchAll(1000);
    writeOut(2000);
    const now = Date.now() / 1000 + 100;
    fs.writeFileSync(path.join(fe, 'src', 'novo.tsx'), 'x');
    fs.utimesSync(path.join(fe, 'src', 'novo.tsx'), now, now);
    expect(needsBuild({ frontendDir: fe })).toBe(true);
  });

  test('out existe mas sem index.html: precisa compilar', () => {
    touchAll(1000);
    fs.mkdirSync(path.join(fe, 'out'));
    expect(needsBuild({ frontendDir: fe })).toBe(true);
  });

  test('frontendDir inexistente: precisa compilar, sem lançar', () => {
    expect(needsBuild({ frontendDir: path.join(fe, 'nada') })).toBe(true);
  });

  test('entradas de config ausentes não quebram', () => {
    fs.rmSync(path.join(fe, 'public'), { recursive: true });
    fs.rmSync(path.join(fe, 'tsconfig.json'));
    touchAll(1000);
    writeOut(2000);
    expect(needsBuild({ frontendDir: fe })).toBe(false);
  });

  test('node_modules e .next mais novos não forçam build', () => {
    touchAll(1000);
    writeOut(2000);
    fs.mkdirSync(path.join(fe, 'node_modules'));
    fs.mkdirSync(path.join(fe, '.next'));
    fs.writeFileSync(path.join(fe, 'node_modules', 'a.js'), 'x');
    fs.writeFileSync(path.join(fe, '.next', 'b.js'), 'x');
    expect(needsBuild({ frontendDir: fe })).toBe(false);
  });
});

describe('isAppRunning / waitForHealth - bordas', () => {
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms) => { t += ms; } };
  };

  test('healthUrl usa 127.0.0.1', () => {
    expect(healthUrl(4567)).toBe('http://127.0.0.1:4567/api/health');
  });

  test('resposta não-200 (500, 404, 503) é false', async () => {
    for (const status of [500, 404, 503]) {
      const fetchFn = jest.fn().mockResolvedValue({ ok: false, status });
      expect(await isAppRunning({ port: 1, fetchFn })).toBe(false);
    }
  });

  test('fetch devolvendo undefined é false (não lança)', async () => {
    expect(await isAppRunning({ port: 1, fetchFn: jest.fn().mockResolvedValue(undefined) })).toBe(false);
  });

  test('passa um AbortSignal para o fetch', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true });
    await isAppRunning({ port: 1, fetchFn });
    expect(fetchFn.mock.calls[0][1].signal).toBeDefined();
  });

  test('fetch que nunca responde: respeita o timeout do sinal (false)', async () => {
    const fetchFn = jest.fn((url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('abort')));
    }));
    const t0 = Date.now();
    expect(await isAppRunning({ port: 1, fetchFn })).toBe(false);
    expect(Date.now() - t0).toBeLessThan(4000);
  });

  test('não-200 repetido até estourar o tempo -> false', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    expect(await waitForHealth({ port: 1, fetchFn, timeoutMs: 1000, intervalMs: 250, ...clock() })).toBe(false);
  });

  test('sucesso na primeira tentativa não dorme', async () => {
    const sleep = jest.fn();
    const fetchFn = jest.fn().mockResolvedValue({ ok: true });
    expect(await waitForHealth({ port: 1, fetchFn, now: () => 0, sleep })).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
  });

  test('sucesso na última tentativa antes do prazo', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true });
    expect(await waitForHealth({ port: 1, fetchFn, timeoutMs: 1000, intervalMs: 500, ...clock() })).toBe(true);
  });
});

describe('CLI startHelpers.js', () => {
  const script = path.join(__dirname, '..', '..', '..', 'scripts', 'startHelpers.js');
  test('comando desconhecido sai com 2 e uso em stderr', () => {
    const r = spawnSync(process.execPath, [script, 'xyz'], { encoding: 'utf8', timeout: 10000 });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Uso:');
  });
  test('running em porta sem app sai com 1', () => {
    const r = spawnSync(process.execPath, [script, 'running'], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PORT: '39871' },
    });
    expect(r.status).toBe(1);
  });
});
