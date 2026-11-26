'use strict';

// Segurança do Electron (D179) sem abrir janela: o módulo `electron` é simulado e o código de window.js / ipc.js roda de verdade.
// Para main.js e preload.js (que dependem do Electron real) a verificação é estática, por leitura do código-fonte.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const mockState = { windows: [], openExternal: [], appHandlers: {}, permission: {}, ipc: {}, exposed: {} };

jest.mock('electron', () => {
  const { EventEmitter: Emitter } = require('events');
  class FakeContents extends Emitter {
    constructor() {
      super();
      this.openHandler = null;
      this.reloads = 0;
    }
    setWindowOpenHandler(handler) {
      this.openHandler = handler;
    }
    reload() {
      this.reloads += 1;
    }
  }
  class BrowserWindow extends Emitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new FakeContents();
      mockState.windows.push(this);
    }
    removeMenu() {}
  }
  const app = {
    isPackaged: false,
    on: (event, handler) => {
      mockState.appHandlers[event] = handler;
    },
  };
  return {
    app,
    BrowserWindow,
    shell: {
      openExternal: (url) => {
        mockState.openExternal.push(url);
        return Promise.resolve();
      },
    },
    session: {
      defaultSession: {
        setPermissionRequestHandler: (fn) => {
          mockState.permission.request = fn;
        },
        setPermissionCheckHandler: (fn) => {
          mockState.permission.check = fn;
        },
      },
    },
    ipcMain: {
      handle: (channel, fn) => {
        mockState.ipc[channel] = fn;
      },
    },
    contextBridge: {
      exposeInMainWorld: (name, api) => {
        mockState.exposed[name] = api;
      },
    },
    ipcRenderer: { invoke: jest.fn(() => 'invoked') },
  };
});

const windowSetup = require('../src/window');
const { registerIpc } = require('../src/ipc');

const ORIGIN = 'http://localhost:3001';
const logger = { info: jest.fn(), error: jest.fn() };

function newContents(getAppOrigin = () => ORIGIN) {
  mockState.openExternal.length = 0;
  windowSetup.installGlobalGuards({ getAppOrigin, logger });
  const contents = new (class extends EventEmitter {
    constructor() {
      super();
      this.openHandler = null;
    }
    setWindowOpenHandler(handler) {
      this.openHandler = handler;
    }
  })();
  mockState.appHandlers['web-contents-created']({}, contents);
  return contents;
}

function navigate(contents, eventName, url) {
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  contents.emit(eventName, event, url);
  return event;
}

describe('createMainWindow: webPreferences', () => {
  test('isolamento, sandbox e sem Node na página', () => {
    const win = windowSetup.createMainWindow({ logger, onRenderGoneTwice: jest.fn() });
    const prefs = win.options.webPreferences;
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.sandbox).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.webSecurity).toBe(true);
    expect(prefs.spellcheck).toBe(false);
    expect(prefs.devTools).toBe(true); // app.isPackaged = false no mock
    expect(prefs.preload).toBe(path.join(__dirname, '..', 'src', 'preload.js'));
    expect(prefs.nodeIntegrationInWorker).toBeUndefined();
    expect(prefs.webviewTag).toBeUndefined();
    expect(prefs.allowRunningInsecureContent).toBeUndefined();
    expect(win.options.width).toBe(1280);
    expect(win.options.height).toBe(800);
    expect(win.options.minWidth).toBe(800);
    expect(win.options.minHeight).toBe(600);
  });

  test('tamanho inicial limitado à área útil, ícone, fundo pelo tema e barra de título nativa', () => {
    const small = windowSetup.createMainWindow({ logger, onRenderGoneTwice: jest.fn(), workArea: { width: 1024, height: 700 } });
    expect(small.options.width).toBe(1024);
    expect(small.options.height).toBe(700);
    const tiny = windowSetup.createMainWindow({ logger, onRenderGoneTwice: jest.fn(), workArea: { width: 500, height: 400 } });
    expect(tiny.options.width).toBe(800);
    expect(tiny.options.height).toBe(600);
    const dark = windowSetup.createMainWindow({ logger, onRenderGoneTwice: jest.fn(), theme: 'DARK' });
    expect(dark.options.backgroundColor).toBe('#0e1f22');
    const system = windowSetup.createMainWindow({ logger, onRenderGoneTwice: jest.fn(), theme: 'SYSTEM', systemDark: true });
    expect(system.options.backgroundColor).toBe('#0e1f22');
    expect(small.options.backgroundColor).toBe('#eef4f3');
    expect(small.options.icon).toBe(path.join(__dirname, '..', 'src', 'assets', 'icon.png'));
    expect(fs.existsSync(small.options.icon)).toBe(true);
    expect(small.options.frame).toBeUndefined();
    expect(small.options.titleBarStyle).toBeUndefined();
    expect(small.options.titleBarOverlay).toBeUndefined();
  });

  test('render-process-gone: recarrega na 1a vez e avisa se repetir em 1 minuto (now injetado)', () => {
    let clock = 5_000_000;
    const onTwice = jest.fn();
    const win = windowSetup.createMainWindow({ logger, onRenderGoneTwice: onTwice, now: () => clock });
    win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(win.webContents.reloads).toBe(1);
    expect(onTwice).not.toHaveBeenCalled();
    clock += 59_000;
    win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(onTwice).toHaveBeenCalledTimes(1);
    expect(win.webContents.reloads).toBe(1);
    clock += 61_000;
    win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(win.webContents.reloads).toBe(2); // fora da janela de 1 min: só recarrega
    expect(onTwice).toHaveBeenCalledTimes(1);
  });
});

describe('installGlobalGuards', () => {
  test('will-navigate e will-redirect: mesma origem passa; https e steam vão ao navegador; o resto é bloqueado', () => {
    const contents = newContents();
    for (const eventName of ['will-navigate', 'will-redirect']) {
      mockState.openExternal.length = 0;
      expect(navigate(contents, eventName, `${ORIGIN}/vendas`).prevented).toBe(false);
      expect(navigate(contents, eventName, 'https://csfloat.com/x').prevented).toBe(true);
      expect(navigate(contents, eventName, 'steam://rungame/730/1/+csgo_econ_action_preview%20S1').prevented).toBe(true);
      expect(mockState.openExternal).toEqual(['https://csfloat.com/x', 'steam://rungame/730/1/+csgo_econ_action_preview%20S1']);
      for (const bad of ['http://evil.com/', 'file:///C:/x', 'javascript:alert(1)', 'data:text/html,x', 'steam://run/440']) {
        expect(navigate(contents, eventName, bad).prevented).toBe(true);
      }
      expect(mockState.openExternal).toHaveLength(2); // nada do "bloqueado" vazou para o openExternal
    }
  });

  test('sem origem do app (backend ainda não subiu): tudo é bloqueado, inclusive localhost e https', () => {
    const contents = newContents(() => null);
    expect(navigate(contents, 'will-navigate', ORIGIN).prevented).toBe(true);
    expect(navigate(contents, 'will-navigate', 'https://x.com/').prevented).toBe(true);
    expect(mockState.openExternal).toEqual([]);
  });

  test('setWindowOpenHandler sempre nega; https/steam abrem no navegador, o resto não', () => {
    const contents = newContents();
    expect(contents.openHandler({ url: 'https://csfloat.com/a' })).toEqual({ action: 'deny' });
    expect(contents.openHandler({ url: ORIGIN + '/x' })).toEqual({ action: 'deny' });
    expect(contents.openHandler({ url: 'file:///x' })).toEqual({ action: 'deny' });
    expect(contents.openHandler({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' });
    expect(mockState.openExternal).toEqual(['https://csfloat.com/a']);
  });

  test('will-attach-webview é impedido', () => {
    const contents = newContents();
    expect(navigate(contents, 'will-attach-webview', undefined).prevented).toBe(true);
  });

  test('falha do openExternal é registrada e não lança', async () => {
    const contents = newContents();
    const shell = require('electron').shell;
    const original = shell.openExternal;
    shell.openExternal = () => Promise.reject(new Error('sem handler'));
    expect(() => navigate(contents, 'will-navigate', 'https://x.com/')).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(logger.error).toHaveBeenCalled();
    shell.openExternal = original;
  });
});

describe('installSessionSecurity', () => {
  test('nega todas as permissões (pedido e verificação)', () => {
    windowSetup.installSessionSecurity();
    const callback = jest.fn();
    mockState.permission.request({}, 'notifications', callback);
    mockState.permission.request({}, 'media', callback);
    expect(callback.mock.calls).toEqual([[false], [false]]);
    expect(mockState.permission.check({}, 'clipboard-read')).toBe(false);
  });
});

describe('IPC desktop:getAppInfo', () => {
  test('só responde a páginas da origem do app', () => {
    registerIpc({ getAppOrigin: () => ORIGIN, getAppInfo: () => ({ isDesktop: true, version: '1.0.0' }) });
    const handler = mockState.ipc['desktop:getAppInfo'];
    expect(handler({ senderFrame: { url: `${ORIGIN}/` } })).toEqual({ isDesktop: true, version: '1.0.0' });
    expect(() => handler({ senderFrame: { url: 'https://evil.com/' } })).toThrow('Origem não autorizada');
    expect(() => handler({ senderFrame: { url: 'http://localhost:3002/' } })).toThrow();
    expect(() => handler({ senderFrame: { url: 'file:///C:/loading.html' } })).toThrow();
    expect(() => handler({ senderFrame: null })).toThrow();
    expect(() => handler({})).toThrow();
  });

  test('sem origem do app definida, recusa', () => {
    registerIpc({ getAppOrigin: () => null, getAppInfo: () => ({}) });
    expect(() => mockState.ipc['desktop:getAppInfo']({ senderFrame: { url: ORIGIN } })).toThrow();
  });
});

describe('preload', () => {
  test('expõe somente a API fixa (app, atualização), sem vazar ipcRenderer ou require', () => {
    jest.isolateModules(() => {
      require('../src/preload');
    });
    const api = mockState.exposed.skinsDesktop;
    expect(Object.keys(api).sort()).toEqual([
      'checkForUpdates',
      'getAppInfo',
      'getUpdateState',
      'isDesktop',
      'onUpdateState',
      'respondToUpdate',
    ]);
    expect(api.isDesktop).toBe(true);
    expect(api.getAppInfo()).toBe('invoked');
    expect(Object.keys(mockState.exposed)).toEqual(['skinsDesktop']);
  });
});

describe('main.js (verificação estática)', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

  test('instância única e segunda instância foca a janela', () => {
    expect(main).toMatch(/app\.requestSingleInstanceLock\(\)/);
    expect(main).toMatch(/app\.on\('second-instance'/);
    expect(main).toMatch(/focusWindow/);
  });

  test('fechar a janela encerra o app; before-quit espera o backend', () => {
    expect(main).toMatch(/window-all-closed/);
    expect(main).toMatch(/before-quit/);
    expect(main).toMatch(/supervisor\s*\.stop\(\)|supervisor\.stop\(\)/);
  });

  test('guardas e segurança de sessão instalados antes da janela', () => {
    expect(main.indexOf('installSessionSecurity')).toBeGreaterThan(-1);
    expect(main.indexOf('installGlobalGuards')).toBeGreaterThan(-1);
    expect(main.indexOf('installGlobalGuards')).toBeLessThan(main.indexOf('startup().catch'));
  });

  test('userData dentro da pasta de dados e sem menu de aplicativo', () => {
    expect(main).toMatch(/setPath\('userData', dataPaths\.electronDir\)/);
    expect(main).toMatch(/Menu\.setApplicationMenu\(null\)/);
  });

  test('nenhum módulo do desktop liga nodeIntegration, desliga sandbox ou webSecurity', () => {
    for (const file of ['main.js', 'window.js', 'preload.js', 'dialogs.js', 'ipc.js']) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
      expect(src).not.toMatch(/nodeIntegration:\s*true/);
      expect(src).not.toMatch(/sandbox:\s*false/);
      expect(src).not.toMatch(/contextIsolation:\s*false/);
      expect(src).not.toMatch(/webSecurity:\s*false/);
      expect(src).not.toMatch(/enableRemoteModule/);
    }
  });
});

describe('.gitignore', () => {
  const ignore = fs.readFileSync(path.join(__dirname, '..', '..', '.gitignore'), 'utf8').split(/\r?\n/);

  test.each(['desktop/.stage/', 'desktop/dist/', 'desktop/node_modules/'])('cobre %s', (entry) => {
    expect(ignore).toContain(entry);
  });
});
