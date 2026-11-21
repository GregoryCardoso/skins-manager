'use strict';

const mockHandlers = {};
jest.mock('electron', () => ({
  ipcMain: { handle: (channel, fn) => (mockHandlers[channel] = fn) },
  contextBridge: { exposeInMainWorld: (name, api) => (mockHandlers.__exposed = { name, api }) },
  ipcRenderer: { invoke: jest.fn((...args) => ({ invoked: args })) },
}));

const { registerIpc } = require('../src/ipc');

const ORIGIN = 'http://127.0.0.1:3001';

beforeEach(() => {
  for (const key of Object.keys(mockHandlers)) delete mockHandlers[key];
});

describe('IPC desktop:checkForUpdates', () => {
  test('atende a origem do app e devolve o resultado', async () => {
    const checkForUpdates = jest.fn(async () => ({ status: 'up-to-date' }));
    registerIpc({ getAppOrigin: () => ORIGIN, getAppInfo: () => ({}), checkForUpdates });
    const res = await mockHandlers['desktop:checkForUpdates']({ senderFrame: { url: `${ORIGIN}/settings` } });
    expect(res).toEqual({ status: 'up-to-date' });
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['outra porta', 'http://127.0.0.1:3002/'],
    ['outro host', 'https://evil.example/'],
    ['localhost em vez de 127.0.0.1', 'http://localhost:3001/'],
    ['file', 'file:///C:/x.html'],
    ['userinfo enganoso', 'http://127.0.0.1:3001@evil.example/'],
    ['vazio', ''],
    ['sem url', undefined],
  ])('recusa remetente: %s', async (_n, url) => {
    const checkForUpdates = jest.fn(async () => ({}));
    registerIpc({ getAppOrigin: () => ORIGIN, getAppInfo: () => ({}), checkForUpdates });
    await expect(mockHandlers['desktop:checkForUpdates']({ senderFrame: url === undefined ? undefined : { url } })).rejects.toThrow();
    expect(checkForUpdates).not.toHaveBeenCalled();
  });

  test('sem origem do app definida (ainda carregando) recusa', async () => {
    const checkForUpdates = jest.fn();
    registerIpc({ getAppOrigin: () => null, getAppInfo: () => ({}), checkForUpdates });
    await expect(mockHandlers['desktop:checkForUpdates']({ senderFrame: { url: `${ORIGIN}/` } })).rejects.toThrow();
    expect(checkForUpdates).not.toHaveBeenCalled();
  });

  test('getAppInfo continua protegido do mesmo jeito', () => {
    registerIpc({ getAppOrigin: () => ORIGIN, getAppInfo: () => ({ ok: 1 }), checkForUpdates: jest.fn() });
    expect(() => mockHandlers['desktop:getAppInfo']({ senderFrame: { url: 'https://evil.example/' } })).toThrow();
    expect(mockHandlers['desktop:getAppInfo']({ senderFrame: { url: `${ORIGIN}/` } })).toEqual({ ok: 1 });
  });

  test('sem checkForUpdates injetado, o canal não é registrado', () => {
    registerIpc({ getAppOrigin: () => ORIGIN, getAppInfo: () => ({}) });
    expect(mockHandlers['desktop:checkForUpdates']).toBeUndefined();
  });

  test('preload encaminha para o canal fixo, sem argumentos do renderer', () => {
    jest.isolateModules(() => require('../src/preload'));
    const { ipcRenderer } = require('electron');
    const api = mockHandlers.__exposed.api;
    api.checkForUpdates('canal-malicioso', { x: 1 });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:checkForUpdates');
  });
});
