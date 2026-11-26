'use strict';

// Segurança dos canais das telas dentro da janela (12.10): só a página local de carregamento, só a janela principal.
const path = require('path');
const { pathToFileURL } = require('url');

const handlers = {};
jest.mock('electron', () => ({
  ipcMain: { handle: (channel, fn) => (handlers[channel] = fn) },
}));

const { registerIpc } = require('../src/ipc');
const { createScreens } = require('../src/screens');

const LOADING_FILE = path.join('C:', 'app', 'src', 'loading.html');
const LOADING_URL = pathToFileURL(LOADING_FILE).href;
const ORIGIN = 'http://localhost:3001';

function setup() {
  const mainContents = { id: 'main' };
  const screens = createScreens({
    dialogs: {},
    loadingFile: LOADING_FILE,
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
  });
  const choose = jest.fn((id) => screens.choose(id));
  registerIpc({
    getAppOrigin: () => ORIGIN,
    getAppInfo: () => ({}),
    getMainWebContents: () => mainContents,
    loadingFile: LOADING_FILE,
    getScreenState: () => screens.getState(),
    chooseScreen: choose,
  });
  const fromPage = (url = LOADING_URL, sender = mainContents) => ({ senderFrame: { url }, sender });
  return { screens, choose, mainContents, fromPage };
}

describe('desktop:screenState e desktop:screenChoice', () => {
  test('a página de carregamento local, na janela principal, lê o estado e escolhe', async () => {
    const { screens, fromPage } = setup();
    const win = {
      isDestroyed: () => false,
      isVisible: () => true,
      show() {},
      loadFile: () => Promise.resolve(),
      webContents: { getURL: () => LOADING_URL, isDestroyed: () => false, send() {} },
    };
    const promise = screens.showRenderGone({ parent: win, language: 'en' });
    expect(handlers['desktop:screenState'](fromPage()).kind).toBe('error');
    expect(handlers['desktop:screenChoice'](fromPage(), { id: 'close' })).toEqual({ ok: true });
    await expect(promise).resolves.toBe('close');
  });

  test.each([
    ['origem http do app', ORIGIN + '/'],
    ['outra origem http', 'http://localhost:3002/'],
    ['site externo', 'https://evil.example/'],
    ['outro arquivo local', pathToFileURL(path.join('C:', 'evil.html')).href],
    ['sem URL', null],
  ])('recusa o estado e a escolha vindos de %s', (label, url) => {
    const { choose, fromPage } = setup();
    expect(() => handlers['desktop:screenState'](fromPage(url))).toThrow('Origem não autorizada');
    expect(() => handlers['desktop:screenChoice'](fromPage(url), { id: 'close' })).toThrow('Origem não autorizada');
    expect(choose).not.toHaveBeenCalled();
  });

  test('recusa evento sem senderFrame', () => {
    setup();
    expect(() => handlers['desktop:screenState']({})).toThrow('Origem não autorizada');
  });

  test('recusa quem não é a janela principal, mesmo com a URL certa', () => {
    const { choose, fromPage } = setup();
    expect(() => handlers['desktop:screenState'](fromPage(LOADING_URL, { id: 'outra' }))).toThrow('Remetente não autorizado');
    expect(() => handlers['desktop:screenChoice'](fromPage(LOADING_URL, { id: 'outra' }), { id: 'close' })).toThrow('Remetente não autorizado');
    expect(choose).not.toHaveBeenCalled();
  });

  test('carga inválida não chega ao main e id fora da lista não resolve nada', () => {
    const { choose, fromPage } = setup();
    for (const payload of [undefined, null, 'close', ['close'], {}, { id: 7 }]) {
      expect(handlers['desktop:screenChoice'](fromPage(), payload)).toEqual({ ok: false });
    }
    expect(choose).not.toHaveBeenCalled();
    expect(handlers['desktop:screenChoice'](fromPage(), { id: 'format-disk', extra: 1 })).toEqual({ ok: false });
    expect(choose).toHaveBeenCalledWith('format-disk'); // o main recusa: não é botão de nenhum estado
  });

  test('os canais da origem do app continuam recusando a página local (e vice-versa)', () => {
    setup();
    expect(() => handlers['desktop:getAppInfo']({ senderFrame: { url: LOADING_URL } })).toThrow();
    expect(handlers['desktop:getAppInfo']({ senderFrame: { url: ORIGIN + '/' } })).toEqual({});
    expect(() => handlers['desktop:screenState']({ senderFrame: { url: ORIGIN + '/' }, sender: {} })).toThrow('Origem não autorizada');
  });
});
