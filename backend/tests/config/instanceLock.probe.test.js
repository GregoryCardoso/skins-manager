const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquireLockVerified, removeStaleLockByProbe, probeSkinsManager, LOCK_FILE_NAME } = require('../../src/config/instanceLock');

let tmp;
let lockPath;
const NOW = new Date('2026-01-01T12:00:00.000Z');
const OLD = '2026-01-01T10:00:00.000Z';

function writeLock(info) {
  fs.writeFileSync(lockPath, JSON.stringify(info));
}
const okFetch = (app) => async () => ({ ok: true, json: async () => ({ success: true, data: { app } }) });

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-lockprobe-'));
  lockPath = path.join(tmp, LOCK_FILE_NAME);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('probeSkinsManager', () => {
  test('responde com app skins-manager: true', async () => {
    expect(await probeSkinsManager({ port: 3001 }, { fetchFn: okFetch('skins-manager') })).toBe(true);
  });
  test('outro app, resposta não ok, erro de rede ou porta inválida: false', async () => {
    expect(await probeSkinsManager({ port: 3001 }, { fetchFn: okFetch('outro') })).toBe(false);
    expect(await probeSkinsManager({ port: 3001 }, { fetchFn: async () => ({ ok: false }) })).toBe(false);
    expect(await probeSkinsManager({ port: 3001 }, { fetchFn: async () => { throw new Error('ECONNREFUSED'); } })).toBe(false);
    expect(await probeSkinsManager({}, { fetchFn: okFetch('skins-manager') })).toBe(false);
  });
  test('consulta só 127.0.0.1 com timeout', async () => {
    const fetchFn = jest.fn(okFetch('skins-manager'));
    await probeSkinsManager({ port: 3055 }, { fetchFn });
    expect(fetchFn.mock.calls[0][0]).toBe('http://127.0.0.1:3055/api/health');
    expect(fetchFn.mock.calls[0][1].signal).toBeDefined();
  });
});

describe('removeStaleLockByProbe / acquireLockVerified', () => {
  test('PID vivo (reaproveitado) mas porta não responde: trava velha, é removida e adquirida', async () => {
    writeLock({ pid: 4242, port: 3001, mode: 'browser', startedAt: OLD });
    const lock = await acquireLockVerified(tmp, { pid: 99, port: 3001, now: NOW, isAlive: () => true, probe: async () => false });
    expect(JSON.parse(fs.readFileSync(lock.lockPath, 'utf8')).pid).toBe(99);
  });

  test('PID vivo e o Skins Manager responde: continua travado, mantendo a mensagem do modo', async () => {
    writeLock({ pid: 4242, port: 3001, mode: 'desktop', startedAt: OLD });
    await expect(
      acquireLockVerified(tmp, { pid: 99, now: NOW, isAlive: () => true, probe: async () => true })
    ).rejects.toMatchObject({ code: 'DATA_DIR_LOCKED', message: 'O Skins Manager já está aberto pelo app desktop.' });
    writeLock({ pid: 4242, port: 3001, mode: 'browser', startedAt: OLD });
    await expect(
      acquireLockVerified(tmp, { pid: 99, now: NOW, isAlive: () => true, probe: async () => true })
    ).rejects.toThrow(/start-app\.bat em http:\/\/localhost:3001/);
  });

  test('trava recente (instância ainda subindo) não é sondada nem removida', async () => {
    writeLock({ pid: 4242, port: 3001, startedAt: new Date(NOW.getTime() - 5000).toISOString() });
    const probe = jest.fn(async () => false);
    expect(await removeStaleLockByProbe(tmp, { isAlive: () => true, probe, now: NOW, pid: 99 })).toBe(false);
    expect(probe).not.toHaveBeenCalled();
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  test('PID morto não sonda (o acquireLock já trata)', async () => {
    writeLock({ pid: 4242, port: 3001, startedAt: OLD });
    const probe = jest.fn(async () => false);
    expect(await removeStaleLockByProbe(tmp, { isAlive: () => false, probe, now: NOW, pid: 99 })).toBe(false);
    expect(probe).not.toHaveBeenCalled();
    const lock = await acquireLockVerified(tmp, { pid: 99, now: NOW, isAlive: () => false });
    expect(lock.lockPath).toBe(lockPath);
  });

  test('sem trava ou com trava ilegível: nada a remover', async () => {
    expect(await removeStaleLockByProbe(tmp, { probe: async () => false })).toBe(false);
    fs.writeFileSync(lockPath, 'lixo{');
    expect(await removeStaleLockByProbe(tmp, { probe: async () => false })).toBe(false);
  });
});
