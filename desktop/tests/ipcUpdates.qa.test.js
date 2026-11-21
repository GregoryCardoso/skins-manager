'use strict';

// QA da v1.0.2: IPC, preload, ligação no main.js e ausência de diálogos nativos de atualização.
const fs = require('fs');
const path = require('path');

const mockHandlers = {};
const mockListeners = [];
jest.mock('electron', () => ({
  ipcMain: { handle: (channel, fn) => (mockHandlers[channel] = fn) },
  contextBridge: { exposeInMainWorld: (name, api) => (mockHandlers.__exposed = { name, api }) },
  ipcRenderer: {
    invoke: jest.fn((...args) => ({ invoked: args })),
    on: jest.fn((channel, listener) => mockListeners.push([channel, listener])),
    removeListener: jest.fn((channel, listener) => {
      const index = mockListeners.findIndex((l) => l[0] === channel && l[1] === listener);
      if (index !== -1) mockListeners.splice(index, 1);
    }),
  },
}));

const { registerIpc, createStatePublisher } = require('../src/ipc');

const ORIGIN = 'http://127.0.0.1:3001';
const SRC = path.join(__dirname, '..', 'src');
const read = (file) => fs.readFileSync(path.join(SRC, file), 'utf8');

beforeEach(() => {
  for (const key of Object.keys(mockHandlers)) delete mockHandlers[key];
  mockListeners.length = 0;
});

describe('canais novos: origem e remetente', () => {
  const MAIN = { id: 'main' };
  const frameAt = (url) => ({ url });

  function register() {
    const getUpdateState = jest.fn(() => ({ seq: 1, phase: 'idle' }));
    const respondToUpdate = jest.fn(() => ({ accepted: true, state: { seq: 2, phase: 'idle' } }));
    registerIpc({
      getAppOrigin: () => ORIGIN,
      getAppInfo: () => ({}),
      checkForUpdates: jest.fn(),
      getUpdateState,
      respondToUpdate,
      getMainWebContents: () => MAIN,
    });
    return { getUpdateState, respondToUpdate };
  }

  test.each([
    ['https disfarçado: host de outra origem com o mesmo prefixo', 'http://127.0.0.1:3001.evil.example/'],
    ['credencial antes do host', 'http://127.0.0.1:3001@evil.example/'],
    ['localhost no lugar de 127.0.0.1', 'http://localhost:3001/'],
    ['outra porta', 'http://127.0.0.1:30011/'],
    ['https na mesma porta', 'https://127.0.0.1:3001/'],
    ['about:blank', 'about:blank'],
    ['data:', 'data:text/html,<script>1</script>'],
    ['file:', 'file:///C:/loading.html'],
    ['javascript:', 'javascript:alert(1)'],
    ['vazio', ''],
  ])('recusa %s nos três canais de atualização', async (_n, url) => {
    const { getUpdateState, respondToUpdate } = register();
    const event = { senderFrame: frameAt(url), sender: MAIN };
    expect(() => mockHandlers['desktop:getUpdateState'](event)).toThrow(/Origem/);
    expect(() => mockHandlers['desktop:updateRespond'](event, { action: 'download', seq: 1 })).toThrow(/Origem/);
    await expect(Promise.resolve().then(() => mockHandlers['desktop:checkForUpdates'](event))).rejects.toThrow(/Origem/);
    expect(getUpdateState).not.toHaveBeenCalled();
    expect(respondToUpdate).not.toHaveBeenCalled();
  });

  test('origem certa mas webContents diferente: recusa antes de ler o payload', () => {
    const { respondToUpdate } = register();
    const event = { senderFrame: frameAt(`${ORIGIN}/`), sender: { id: 'iframe ou janela filha' } };
    expect(() => mockHandlers['desktop:updateRespond'](event, { action: 'download', seq: 1 })).toThrow(/Remetente/);
    // um payload que seria inválido também lança pelo remetente, sem vazar nada do estado
    expect(() => mockHandlers['desktop:updateRespond'](event, null)).toThrow(/Remetente/);
    expect(respondToUpdate).not.toHaveBeenCalled();
  });

  test('a janela principal mudou (recarregada com outro webContents): o antigo é recusado', () => {
    let current = MAIN;
    const getUpdateState = jest.fn(() => ({ seq: 1 }));
    registerIpc({
      getAppOrigin: () => ORIGIN,
      getAppInfo: () => ({}),
      getUpdateState,
      respondToUpdate: jest.fn(),
      getMainWebContents: () => current,
    });
    const event = { senderFrame: frameAt(`${ORIGIN}/`), sender: MAIN };
    expect(mockHandlers['desktop:getUpdateState'](event)).toEqual({ seq: 1 });
    current = { id: 'novo' };
    expect(() => mockHandlers['desktop:getUpdateState'](event)).toThrow(/Remetente/);
  });

  test('sem getMainWebContents injetado os canais novos recusam todo remetente', () => {
    registerIpc({ getAppOrigin: () => ORIGIN, getAppInfo: () => ({}), getUpdateState: () => ({}), respondToUpdate: () => ({}) });
    const event = { senderFrame: frameAt(`${ORIGIN}/`), sender: MAIN };
    expect(() => mockHandlers['desktop:getUpdateState'](event)).toThrow(/Remetente/);
    expect(() => mockHandlers['desktop:updateRespond'](event, { action: 'download', seq: 1 })).toThrow(/Remetente/);
  });

  test('payload com protótipo adulterado, extras e URL só repassa { action, seq } (objeto novo)', async () => {
    const { respondToUpdate } = register();
    const payload = JSON.parse('{"action":"openDownloadPage","seq":4,"url":"https://evil.example","__proto__":{"action":"download"},"constructor":"x"}');
    await mockHandlers['desktop:updateRespond']({ senderFrame: frameAt(`${ORIGIN}/`), sender: MAIN }, payload);
    expect(respondToUpdate).toHaveBeenCalledTimes(1);
    const sent = respondToUpdate.mock.calls[0][0];
    expect(sent).toEqual({ action: 'openDownloadPage', seq: 4 });
    expect(sent).not.toBe(payload);
    expect(Object.keys(sent)).toEqual(['action', 'seq']);
  });

  test('o IPC não repassa exceções internas do updater como estado (erro do respond propaga)', async () => {
    registerIpc({
      getAppOrigin: () => ORIGIN,
      getAppInfo: () => ({}),
      getUpdateState: () => ({}),
      respondToUpdate: () => {
        throw new Error('quebrou');
      },
      getMainWebContents: () => MAIN,
    });
    expect(() =>
      mockHandlers['desktop:updateRespond']({ senderFrame: frameAt(`${ORIGIN}/`), sender: MAIN }, { action: 'download', seq: 1 }),
    ).toThrow('quebrou');
  });
});

describe('createStatePublisher: lacunas', () => {
  const STATE = { seq: 1, phase: 'ready' };
  const make = (url, extra = {}) => ({ getURL: () => url, send: jest.fn(), isDestroyed: () => false, ...extra });

  test.each([
    ['página de carregamento (file)', 'file:///C:/app/loading.html'],
    ['página de erro do Chromium', 'chrome-error://chromewebdata/'],
    ['origem parecida', 'http://127.0.0.1:3001.evil.example/'],
    ['credencial', 'http://127.0.0.1:3001@evil.example/'],
    ['outra porta', 'http://127.0.0.1:3002/'],
    ['about:blank (durante o reload)', 'about:blank'],
    ['vazio', ''],
  ])('não envia com a janela em %s', (_n, url) => {
    const webContents = make(url);
    const publish = createStatePublisher({ getWebContents: () => webContents, getAppOrigin: () => ORIGIN });
    expect(publish(STATE)).toBe(false);
    expect(webContents.send).not.toHaveBeenCalled();
  });

  test('janela na origem do app (qualquer caminho e query) recebe exatamente o estado, no canal fixo', () => {
    const webContents = make(`${ORIGIN}/settings?x=1#a`);
    const publish = createStatePublisher({ getWebContents: () => webContents, getAppOrigin: () => ORIGIN });
    expect(publish(STATE)).toBe(true);
    expect(webContents.send.mock.calls).toEqual([['desktop:updateState', STATE]]);
  });

  test('a origem é lida a cada envio (muda quando o backend reinicia em outra porta)', () => {
    let origin = ORIGIN;
    const webContents = make(`${ORIGIN}/`);
    const publish = createStatePublisher({ getWebContents: () => webContents, getAppOrigin: () => origin });
    expect(publish(STATE)).toBe(true);
    origin = 'http://127.0.0.1:3005';
    expect(publish(STATE)).toBe(false);
    expect(webContents.send).toHaveBeenCalledTimes(1);
  });
});

describe('preload: superfície exposta e cancelamento', () => {
  function loadApi() {
    jest.isolateModules(() => require('../src/preload'));
    return { api: mockHandlers.__exposed.api, name: mockHandlers.__exposed.name, ipcRenderer: require('electron').ipcRenderer };
  }

  test('expõe só as funções necessárias, sem ipcRenderer, event nem canais livres', () => {
    const { api, name } = loadApi();
    expect(name).toBe('skinsDesktop');
    expect(Object.keys(api).sort()).toEqual(
      ['checkForUpdates', 'getAppInfo', 'getUpdateState', 'isDesktop', 'onUpdateState', 'respondToUpdate'].sort(),
    );
    expect(api.isDesktop).toBe(true);
    for (const key of Object.keys(api)) if (key !== 'isDesktop') expect(typeof api[key]).toBe('function');
  });

  test('o preload só usa canais fixos (nenhum canal vem do renderer)', () => {
    const source = fs.readFileSync(path.join(SRC, 'preload.js'), 'utf8');
    const used = [...source.matchAll(/(?:invoke|on|removeListener)\(\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2]);
    expect(used.sort()).toEqual(
      ['desktop:checkForUpdates', 'desktop:getAppInfo', 'desktop:getUpdateState', 'desktop:updateRespond', 'desktop:updateState', 'desktop:updateState'].sort(),
    );
    expect(source).not.toMatch(/ipcRenderer\.(send|sendSync|sendTo|postMessage)|\bremote\b|webFrame|require\((?!['"]electron['"])/);
  });

  test('respondToUpdate com argumentos extras ou de tipos estranhos só envia { action, seq }', () => {
    const { api, ipcRenderer } = loadApi();
    api.respondToUpdate('download', 7, { url: 'https://evil.example' }, 'x');
    api.respondToUpdate({ toString: () => 'restart' }, '8');
    expect(ipcRenderer.invoke.mock.calls[0]).toEqual(['desktop:updateRespond', { action: 'download', seq: 7 }]);
    expect(Object.keys(ipcRenderer.invoke.mock.calls[1][1])).toEqual(['action', 'seq']);
  });

  test('duas inscrições são independentes: cancelar uma mantém a outra', () => {
    const { api } = loadApi();
    const a = jest.fn();
    const b = jest.fn();
    const stopA = api.onUpdateState(a);
    api.onUpdateState(b);
    expect(mockListeners).toHaveLength(2);
    stopA();
    expect(mockListeners).toHaveLength(1);
    mockListeners[0][1]({ sender: 'x' }, { seq: 1 });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith({ seq: 1 });
  });

  test('cancelar duas vezes é inofensivo; a função devolvida não recebe nem devolve o listener', () => {
    const { api } = loadApi();
    const stop = api.onUpdateState(jest.fn());
    expect(stop()).toBeUndefined();
    expect(() => stop()).not.toThrow();
    expect(mockListeners).toHaveLength(0);
  });

  test('o callback recebe um único argumento (o estado), mesmo que o main mande mais', () => {
    const { api } = loadApi();
    const callback = jest.fn();
    api.onUpdateState(callback);
    mockListeners[0][1]({ sender: 'x', senderId: 1 }, { seq: 3 }, 'extra', 'extra2');
    expect(callback.mock.calls[0]).toHaveLength(1);
    expect(callback.mock.calls[0][0]).toEqual({ seq: 3 });
  });
});

describe('ligação no main.js e ausência de diálogos de atualização', () => {
  const main = read('main.js');

  test('o before-quit encerra o backend e só depois chama installPendingOnQuit', () => {
    const start = main.indexOf("app.on('before-quit'");
    expect(start).toBeGreaterThan(-1);
    const block = main.slice(start, start + 900);
    expect(block.indexOf('supervisor')).toBeGreaterThan(-1);
    expect(block.indexOf('.stop()')).toBeGreaterThan(-1);
    expect(block.indexOf('installPendingOnQuit')).toBeGreaterThan(block.indexOf('.stop()'));
    expect(block.indexOf('app.quit()')).toBeGreaterThan(block.indexOf('installPendingOnQuit'));
  });

  test('nenhum caminho do main instala sem o clique: sem autoInstallOnAppQuit = true nem quitAndInstall fora do updater', () => {
    for (const file of fs.readdirSync(SRC, { recursive: true }).filter((f) => String(f).endsWith('.js'))) {
      const source = fs.readFileSync(path.join(SRC, file), 'utf8');
      expect([file, /autoInstallOnAppQuit\s*=\s*true/.test(source)]).toEqual([file, false]);
      expect([file, /autoDownload\s*=\s*true/.test(source)]).toEqual([file, false]);
      if (!String(file).endsWith('updater.js')) expect([file, /quitAndInstall/.test(source)]).toEqual([file, false]);
    }
  });

  test('o main injeta o publicador, o estado e a resposta, sem dialogs no updater', () => {
    const block = main.slice(main.indexOf('createUpdater({'), main.indexOf('createUpdater({') + 900);
    expect(block).toMatch(/publishState:\s*createStatePublisher/);
    expect(block).not.toMatch(/dialogs|getParent|getLanguage/);
    expect(main).toMatch(/getUpdateState:\s*\(\)\s*=>\s*updater\.getState\(\)/);
    expect(main).toMatch(/respondToUpdate:\s*\(payload\)\s*=>\s*updater\.respond\(payload\)/);
    expect(main).toMatch(/getMainWebContents/);
  });

  test('dialogs.js e i18n.js do desktop não têm mais nada de atualização', () => {
    const dialogs = require('../src/dialogs');
    for (const name of ['showUpdateAvailable', 'showUpdateReady', 'showUpdateError', 'showPortableUpdate', 'withNotes']) {
      expect(dialogs[name]).toBeUndefined();
    }
    expect(Object.keys(dialogs).sort()).toEqual(
      ['showAlreadyOpen', 'showCrashLoop', 'showNoFreePort', 'showRenderGone', 'showStageMissing', 'showStartFailure'].sort(),
    );
    const i18n = read('i18n.js');
    expect(i18n).not.toMatch(/['"]?update\.[a-zA-Z]+['"]?\s*:/);
    expect(i18n).not.toMatch(/\bupdate\b\s*:\s*\{/);
  });

  test('os diálogos nativos que não são de atualização continuam existindo e usados pelo main', () => {
    for (const name of ['showStartFailure', 'showAlreadyOpen', 'showNoFreePort', 'showCrashLoop', 'showStageMissing', 'showRenderGone']) {
      expect(typeof require('../src/dialogs')[name]).toBe('function');
      expect(main).toContain(name);
    }
  });

  test('nenhum arquivo do desktop mostra diálogo de atualização', () => {
    for (const file of fs.readdirSync(SRC, { recursive: true }).filter((f) => String(f).endsWith('.js'))) {
      const source = fs.readFileSync(path.join(SRC, file), 'utf8');
      expect([file, /showUpdate|showPortableUpdate|askRestart/.test(source)]).toEqual([file, false]);
    }
  });
});
