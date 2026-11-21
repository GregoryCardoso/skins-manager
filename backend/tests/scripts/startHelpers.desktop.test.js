const fs = require('fs');
const os = require('os');
const path = require('path');
const { isAppRunning, readLockInfo, isDesktopLock, LOCK_FILE_NAME } = require('../../../scripts/startHelpers');

const jsonRes = (body, ok = true) => ({ ok, json: async () => body });

describe('isAppRunning confere o app no JSON do /api/health', () => {
  test('app skins-manager: true', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonRes({ success: true, data: { app: 'skins-manager' } }));
    expect(await isAppRunning({ port: 3001, fetchFn })).toBe(true);
  });

  test('200 de outro programa (JSON diferente, sem app, não JSON ou nulo): false', async () => {
    for (const body of [{ success: true, data: { app: 'outro' } }, { status: 'ok' }, { data: null }, null, 'texto']) {
      expect(await isAppRunning({ port: 3001, fetchFn: jest.fn().mockResolvedValue(jsonRes(body)) })).toBe(false);
    }
    const notJson = { ok: true, json: async () => { throw new SyntaxError('x'); } };
    expect(await isAppRunning({ port: 3001, fetchFn: jest.fn().mockResolvedValue(notJson) })).toBe(false);
  });
});

describe('trava da pasta de dados', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-bat-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (text) => fs.writeFileSync(path.join(dir, LOCK_FILE_NAME), text);

  test('modo desktop é reconhecido', () => {
    write(JSON.stringify({ pid: 1, port: 3001, mode: 'desktop' }));
    expect(readLockInfo(dir).port).toBe(3001);
    expect(isDesktopLock(dir)).toBe(true);
  });

  test('modo browser, sem trava, ilegível ou sem pasta: não é desktop', () => {
    write(JSON.stringify({ pid: 1, mode: 'browser' }));
    expect(isDesktopLock(dir)).toBe(false);
    fs.rmSync(path.join(dir, LOCK_FILE_NAME));
    expect(isDesktopLock(dir)).toBe(false);
    write('lixo{');
    expect(isDesktopLock(dir)).toBe(false);
    write('null');
    expect(isDesktopLock(dir)).toBe(false);
    expect(isDesktopLock(null)).toBe(false);
  });
});
