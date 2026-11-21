'use strict';

const path = require('path');
const { resolveDataDir, resolveDataPaths, resolveAppRoot, resolveAppPaths } = require('../src/lib/paths');

describe('resolveDataDir', () => {
  test('Windows usa %APPDATA%\\SkinsManager', () => {
    expect(resolveDataDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\Ana\\AppData\\Roaming' }, homedir: 'C:\\Users\\Ana' })).toBe(
      'C:\\Users\\Ana\\AppData\\Roaming\\SkinsManager'
    );
  });

  test('Windows sem APPDATA cai para a pasta do usuário', () => {
    expect(resolveDataDir({ platform: 'win32', env: {}, homedir: 'C:\\Users\\Ana' })).toBe('C:\\Users\\Ana\\AppData\\Roaming\\SkinsManager');
  });

  test('fora do Windows (só CI)', () => {
    expect(resolveDataDir({ platform: 'linux', env: {}, homedir: '/home/ana' })).toBe('/home/ana/.skins-manager');
  });
});

describe('resolveDataPaths', () => {
  test('layout da pasta de dados (D171)', () => {
    expect(resolveDataPaths('C:\\Users\\Ana\\AppData\\Roaming\\SkinsManager')).toEqual({
      dataDir: 'C:\\Users\\Ana\\AppData\\Roaming\\SkinsManager',
      dbPath: 'C:\\Users\\Ana\\AppData\\Roaming\\SkinsManager\\inventory.sqlite',
      logsDir: 'C:\\Users\\Ana\\AppData\\Roaming\\SkinsManager\\logs',
      electronDir: 'C:\\Users\\Ana\\AppData\\Roaming\\SkinsManager\\electron',
      lockPath: 'C:\\Users\\Ana\\AppData\\Roaming\\SkinsManager\\skins-manager.lock',
    });
  });

  test('estilo POSIX', () => {
    expect(resolveDataPaths('/home/ana/.skins-manager').logsDir).toBe('/home/ana/.skins-manager/logs');
  });
});

describe('resolveAppRoot / resolveAppPaths', () => {
  test('desenvolvimento usa desktop/.stage', () => {
    const root = resolveAppRoot({ isPackaged: false, resourcesPath: '/res', desktopDir: path.join('/x', 'desktop') });
    expect(root).toBe(path.join('/x', 'desktop', '.stage'));
    expect(resolveAppPaths(root).backendEntry).toBe(path.join(root, 'backend', 'server.js'));
    expect(resolveAppPaths(root).frontendIndex).toBe(path.join(root, 'frontend', 'out', 'index.html'));
  });

  test('empacotado usa <resources>/skins-manager', () => {
    expect(resolveAppRoot({ isPackaged: true, resourcesPath: path.join('/res'), desktopDir: '/x' })).toBe(path.join('/res', 'skins-manager'));
  });
});
