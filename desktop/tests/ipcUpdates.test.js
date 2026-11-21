'use strict';

const mockHandlers = {};
jest.mock('electron', () => ({
  ipcMain: { handle: (channel, fn) => (mockHandlers[channel] = fn) },
  contextBridge: { exposeInMainWorld: (name, api) => (mockHandlers.__exposed = { name, api }) },
  ipcRenderer: {
    invoke: jest.fn((...args) => ({ invoked: args })),
    on: jest.fn((channel, listener) => (mockHandlers[`on:${channel}`] = listener)),
    removeListener: jest.fn(),
  },
}));

const { registerIpc, createStatePublisher } = require('../src/ipc');

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

// ---- Canais da atualização dentro do app (D188) ----
describe('IPC desktop:getUpdateState e desktop:updateRespond', () => {
  const MAIN = { id: 'janela principal' };
  const OTHER = { id: 'outro webContents' };
  const STATE = { seq: 3, phase: 'available' };
  const frame = { url: `${ORIGIN}/settings` };

  function register(extra = {}) {
    const getUpdateState = jest.fn(() => STATE);
    const respondToUpdate = jest.fn(() => ({ accepted: true, state: STATE }));
    registerIpc({
      getAppOrigin: () => ORIGIN,
      getAppInfo: () => ({}),
      checkForUpdates: jest.fn(),
      getUpdateState,
      respondToUpdate,
      getMainWebContents: () => MAIN,
      ...extra,
    });
    return { getUpdateState, respondToUpdate };
  }

  test('atendem a janela principal na origem do app', async () => {
    const { getUpdateState, respondToUpdate } = register();
    expect(mockHandlers['desktop:getUpdateState']({ senderFrame: frame, sender: MAIN })).toEqual(STATE);
    const res = await mockHandlers['desktop:updateRespond']({ senderFrame: frame, sender: MAIN }, { action: 'download', seq: 3 });
    expect(res).toEqual({ accepted: true, state: STATE });
    expect(getUpdateState).toHaveBeenCalledTimes(1);
    expect(respondToUpdate).toHaveBeenCalledWith({ action: 'download', seq: 3 });
  });

  test.each([
    ['desktop:getUpdateState', undefined],
    ['desktop:updateRespond', { action: 'download', seq: 3 }],
  ])('%s recusa outra origem', (channel, payload) => {
    const { getUpdateState, respondToUpdate } = register();
    for (const url of ['https://evil.example/', 'http://127.0.0.1:3002/', 'file:///C:/x.html', '', undefined]) {
      const event = { senderFrame: url === undefined ? undefined : { url }, sender: MAIN };
      expect(() => mockHandlers[channel](event, payload)).toThrow(/Origem/);
    }
    expect(getUpdateState).not.toHaveBeenCalled();
    expect(respondToUpdate).not.toHaveBeenCalled();
  });

  test.each([
    ['desktop:getUpdateState', undefined],
    ['desktop:updateRespond', { action: 'download', seq: 3 }],
  ])('%s recusa outro webContents, mesmo na origem certa', (channel, payload) => {
    const { getUpdateState, respondToUpdate } = register();
    expect(() => mockHandlers[channel]({ senderFrame: frame, sender: OTHER }, payload)).toThrow(/Remetente/);
    expect(() => mockHandlers[channel]({ senderFrame: frame }, payload)).toThrow(/Remetente/);
    expect(getUpdateState).not.toHaveBeenCalled();
    expect(respondToUpdate).not.toHaveBeenCalled();
  });

  test('sem janela principal, recusa', () => {
    register({ getMainWebContents: () => null });
    expect(() => mockHandlers['desktop:getUpdateState']({ senderFrame: frame, sender: null })).toThrow(/Remetente/);
  });

  test.each([
    ['null', null],
    ['texto', 'download'],
    ['array', ['download', 3]],
    ['sem seq', { action: 'download' }],
    ['seq texto', { action: 'download', seq: '3' }],
    ['seq decimal', { action: 'download', seq: 1.5 }],
    ['seq infinito', { action: 'download', seq: Infinity }],
    ['seq negativo', { action: 'download', seq: -1 }],
    ['ação fora do enum', { action: 'formatar', seq: 3 }],
    ['ação não texto', { action: 7, seq: 3 }],
    ['sem ação', { seq: 3 }],
  ])('payload inválido (%s): accepted false, sem efeito', async (_n, payload) => {
    const { respondToUpdate } = register();
    const res = await mockHandlers['desktop:updateRespond']({ senderFrame: frame, sender: MAIN }, payload);
    expect(res).toEqual({ accepted: false, state: STATE });
    expect(respondToUpdate).not.toHaveBeenCalled();
  });

  test('campos extras, como uma url, nunca chegam ao updater', async () => {
    const { respondToUpdate } = register();
    await mockHandlers['desktop:updateRespond'](
      { senderFrame: frame, sender: MAIN },
      { action: 'openDownloadPage', seq: 3, url: 'https://evil.example/' }
    );
    expect(respondToUpdate).toHaveBeenCalledWith({ action: 'openDownloadPage', seq: 3 });
    expect(Object.keys(respondToUpdate.mock.calls[0][0])).toEqual(['action', 'seq']);
  });

  test('sem as funções injetadas, os canais não são registrados', () => {
    registerIpc({ getAppOrigin: () => ORIGIN, getAppInfo: () => ({}) });
    expect(mockHandlers['desktop:getUpdateState']).toBeUndefined();
    expect(mockHandlers['desktop:updateRespond']).toBeUndefined();
  });
});

describe('createStatePublisher (main -> renderer)', () => {
  const STATE = { seq: 1, phase: 'available' };
  const make = (url, extra = {}) => {
    const webContents = { getURL: () => url, send: jest.fn(), isDestroyed: () => false, ...extra };
    return { webContents, publish: createStatePublisher({ getWebContents: () => webContents, getAppOrigin: () => ORIGIN }) };
  };

  test('envia só o estado, no canal fixo, quando a janela está na origem do app', () => {
    const { webContents, publish } = make(`${ORIGIN}/settings/`);
    expect(publish(STATE)).toBe(true);
    expect(webContents.send).toHaveBeenCalledWith('desktop:updateState', STATE);
  });

  test.each([
    ['tela de carregamento (file:)', 'file:///C:/app/loading.html'],
    ['página de erro do Chromium', 'chrome-error://chromewebdata/'],
    ['outra origem', 'https://evil.example/'],
    ['outra porta', 'http://127.0.0.1:3002/'],
    ['vazio', ''],
  ])('não envia com a janela em: %s', (_n, url) => {
    const { webContents, publish } = make(url);
    expect(publish(STATE)).toBe(false);
    expect(webContents.send).not.toHaveBeenCalled();
  });

  test('sem janela ou com janela destruída, não envia', () => {
    const noWindow = createStatePublisher({ getWebContents: () => null, getAppOrigin: () => ORIGIN });
    expect(noWindow(STATE)).toBe(false);
    const { webContents, publish } = make(`${ORIGIN}/`, { isDestroyed: () => true });
    expect(publish(STATE)).toBe(false);
    expect(webContents.send).not.toHaveBeenCalled();
  });

  test('sem origem do app definida (ainda carregando), não envia', () => {
    const webContents = { getURL: () => `${ORIGIN}/`, send: jest.fn(), isDestroyed: () => false };
    const publish = createStatePublisher({ getWebContents: () => webContents, getAppOrigin: () => null });
    expect(publish(STATE)).toBe(false);
    expect(webContents.send).not.toHaveBeenCalled();
  });
});

describe('preload: atualização dentro do app', () => {
  function loadApi() {
    jest.isolateModules(() => require('../src/preload'));
    return { api: mockHandlers.__exposed.api, ipcRenderer: require('electron').ipcRenderer };
  }

  test('getUpdateState e respondToUpdate usam canais fixos e só { action, seq }', () => {
    const { api, ipcRenderer } = loadApi();
    api.getUpdateState('canal-malicioso');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:getUpdateState');
    api.respondToUpdate('download', 7, 'https://evil.example/');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('desktop:updateRespond', { action: 'download', seq: 7 });
  });

  test('onUpdateState entrega ao callback só o estado (nunca o event) e devolve o cancelamento', () => {
    const { api, ipcRenderer } = loadApi();
    const callback = jest.fn();
    const unsubscribe = api.onUpdateState(callback);
    expect(ipcRenderer.on).toHaveBeenCalledWith('desktop:updateState', expect.any(Function));
    const listener = mockHandlers['on:desktop:updateState'];
    listener({ sender: 'segredo do ipcRenderer' }, { seq: 2, phase: 'ready' });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]).toEqual([{ seq: 2, phase: 'ready' }]);
    unsubscribe();
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('desktop:updateState', listener);
  });

  test('onUpdateState sem função não registra nada', () => {
    const { api, ipcRenderer } = loadApi();
    ipcRenderer.on.mockClear();
    const unsubscribe = api.onUpdateState('não é função');
    expect(ipcRenderer.on).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });
});
