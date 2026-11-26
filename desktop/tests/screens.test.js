'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { createScreens, SCREEN_STATE_CHANNEL } = require('../src/screens');
const { translate, LANGUAGES } = require('../src/i18n');

const LOADING_FILE = path.join('C:', 'app', 'src', 'loading.html');
const LOADING_URL = pathToFileURL(LOADING_FILE).href;

function makeWindow({ url = 'http://localhost:3001/', visible = true, loadFile } = {}) {
  const win = {
    destroyed: false,
    visible,
    shown: 0,
    loaded: [],
    sent: [],
    isDestroyed: () => win.destroyed,
    isVisible: () => win.visible,
    show: () => {
      win.visible = true;
      win.shown += 1;
    },
    loadFile: jest.fn((file) => {
      win.loaded.push(file);
      if (loadFile) return loadFile(file);
      win.webContents.url = LOADING_URL;
      return Promise.resolve();
    }),
    webContents: {
      url,
      getURL: () => win.webContents.url,
      isDestroyed: () => false,
      send: (channel, state) => win.sent.push([channel, state]),
    },
  };
  return win;
}

function makeDialogs() {
  const names = ['showStartFailure', 'showAlreadyOpen', 'showNoFreePort', 'showCrashLoop', 'showRenderGone', 'showStageMissing'];
  return Object.fromEntries(names.map((name) => [name, jest.fn(() => Promise.resolve('native-choice'))]));
}

function makeTimers() {
  const timers = new Map();
  let next = 1;
  return {
    setTimeoutFn: (fn) => {
      timers.set(next, fn);
      return next++;
    },
    clearTimeoutFn: (id) => timers.delete(id),
    fire: () => [...timers.values()].forEach((fn) => fn()),
    pending: () => timers.size,
  };
}

function setup(overrides = {}) {
  const dialogs = makeDialogs();
  const timers = makeTimers();
  const logs = [];
  const screens = createScreens({ dialogs, loadingFile: LOADING_FILE, logger: { info: (t) => logs.push(t) }, ...timers, ...overrides });
  return { screens, dialogs, timers, logs };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('screens: tela dentro da janela', () => {
  test('carrega a página, entrega o estado e resolve pela escolha do usuário', async () => {
    const { screens, dialogs } = setup();
    const win = makeWindow();
    const promise = screens.showStartFailure({ parent: win, language: 'pt-BR', code: 'START_TIMEOUT', message: '' });
    expect(win.loadFile).toHaveBeenCalledWith(LOADING_FILE);
    const state = screens.getState(); // a página pediu o estado
    expect(state.kind).toBe('error');
    expect(state.lang).toBe('pt-BR');
    expect(state.title).toBe(translate('pt-BR', 'startFailure.title'));
    expect(state.detail).toBe(translate('pt-BR', 'startFailure.timeout'));
    expect(state.technical).toBe('START_TIMEOUT');
    expect(state.technicalLabel).toBe('Detalhes técnicos');
    expect(state.regionLabel).toBe('Mensagem de erro');
    expect(state.buttons.map((b) => b.id)).toEqual(['retry', 'open-logs', 'open-data', 'close']);
    expect(state.buttons[0]).toMatchObject({ label: 'Tentar de novo', primary: true });
    expect(state.buttons.slice(1).some((b) => b.primary)).toBe(false);
    expect(screens.choose('retry')).toEqual({ ok: true });
    await expect(promise).resolves.toBe('retry');
    expect(dialogs.showStartFailure).not.toHaveBeenCalled();
  });

  test('com a página já aberta, só empurra o estado novo (sem recarregar)', async () => {
    const { screens } = setup();
    const win = makeWindow({ url: LOADING_URL });
    screens.getState(); // página pronta
    const promise = screens.showNoFreePort({ parent: win, language: 'en' });
    expect(win.loadFile).not.toHaveBeenCalled();
    expect(win.sent).toHaveLength(1);
    expect(win.sent[0][0]).toBe(SCREEN_STATE_CHANNEL);
    expect(win.sent[0][1].buttons.map((b) => b.id)).toEqual(['close']);
    screens.choose('close');
    await expect(promise).resolves.toBe('close');
  });

  test('mostra a janela se ela ainda estava escondida', async () => {
    const { screens } = setup();
    const win = makeWindow({ visible: false });
    const promise = screens.showRenderGone({ parent: win, language: 'en' });
    expect(win.shown).toBe(1);
    screens.getState();
    screens.choose('close');
    await promise;
  });

  test('o tema escolhido vai no estado (minúsculo)', async () => {
    const { screens } = setup();
    screens.setTheme('DARK');
    const promise = screens.showRenderGone({ parent: makeWindow(), language: 'en' });
    expect(screens.getState().theme).toBe('dark');
    screens.choose('close');
    await promise;
  });

  test('informação (já aberto) tem botão principal "abrir no navegador" e rótulo pelo título', async () => {
    const { screens } = setup();
    const promise = screens.showAlreadyOpen({ parent: makeWindow(), language: 'en', port: 3001 });
    const state = screens.getState();
    expect(state.kind).toBe('info');
    expect(state.message).toContain('http://localhost:3001');
    expect(state.regionLabel).toBe(state.title);
    expect(state.buttons[0]).toMatchObject({ id: 'open-browser', primary: true });
    screens.choose('open-browser');
    await expect(promise).resolves.toBe('open-browser');
  });

  test('falha de início com porta do navegador acrescenta "abrir no navegador" e o detalhe técnico', async () => {
    const { screens } = setup();
    const promise = screens.showStartFailure({ parent: makeWindow(), language: 'en', code: 'DATA_DIR_LOCKED', message: 'Pasta em uso', browserUrl: 'http://localhost:3001/' });
    const state = screens.getState();
    expect(state.buttons.map((b) => b.id)).toEqual(['retry', 'open-logs', 'open-data', 'open-browser', 'close']);
    expect(state.detail).toBe('Pasta em uso');
    expect(state.technical).toBe('DATA_DIR_LOCKED\nPasta em uso');
    screens.choose('close');
    await promise;
  });

  test('crash repetido: tentar de novo, abrir registros e fechar; mostra a pasta de dados', async () => {
    const { screens } = setup();
    const promise = screens.showCrashLoop({ parent: makeWindow(), language: 'en', dataDir: 'C:\\dados' });
    const state = screens.getState();
    expect(state.buttons.map((b) => b.id)).toEqual(['retry', 'open-logs', 'close']);
    expect(state.detail).toContain('C:\\dados');
    screens.choose('open-logs');
    await expect(promise).resolves.toBe('open-logs');
  });

  test.each(LANGUAGES)('estado de erro em %s usa só textos traduzidos (nada de chave crua)', async (language) => {
    const { screens } = setup();
    const promise = screens.showStartFailure({ parent: makeWindow(), language, code: 'BACKEND_EXITED', message: '' });
    const state = screens.getState();
    for (const text of [state.title, state.message, state.detail, state.technicalLabel, state.regionLabel, ...state.buttons.map((b) => b.label)]) {
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/^[a-zA-Z]+\.[a-zA-Z]+$/);
    }
    screens.choose('close');
    await promise;
  });
});

describe('screens: escolhas recusadas', () => {
  test('id que não é botão do estado atual não resolve', async () => {
    const { screens } = setup();
    const promise = screens.showNoFreePort({ parent: makeWindow(), language: 'en' });
    screens.getState();
    expect(screens.choose('retry')).toEqual({ ok: false });
    expect(screens.choose('format-disk')).toEqual({ ok: false });
    expect(screens.choose(undefined)).toEqual({ ok: false });
    expect(screens.choose('close')).toEqual({ ok: true });
    await expect(promise).resolves.toBe('close');
  });

  test('sem tela esperando, qualquer escolha é recusada; e a mesma escolha não vale duas vezes', async () => {
    const { screens } = setup();
    expect(screens.choose('close')).toEqual({ ok: false });
    const promise = screens.showRenderGone({ parent: makeWindow(), language: 'en' });
    screens.getState();
    expect(screens.choose('close')).toEqual({ ok: true });
    expect(screens.choose('close')).toEqual({ ok: false });
    await promise;
  });

  test('uma tela nova encerra a anterior como "close"', async () => {
    const { screens } = setup();
    const win = makeWindow();
    const first = screens.showRenderGone({ parent: win, language: 'en' });
    screens.getState();
    const second = screens.showNoFreePort({ parent: win, language: 'en' });
    await expect(first).resolves.toBe('close');
    screens.choose('close');
    await expect(second).resolves.toBe('close');
  });
});

describe('screens: reserva pelo diálogo nativo', () => {
  test('sem janela, chama o diálogo nativo com os mesmos argumentos', async () => {
    const { screens, dialogs } = setup();
    await expect(screens.showStartFailure({ parent: null, language: 'en', code: 'X', message: 'm', browserUrl: null })).resolves.toBe('native-choice');
    expect(dialogs.showStartFailure).toHaveBeenCalledWith({ parent: null, language: 'en', code: 'X', message: 'm', browserUrl: null });
    await screens.showAlreadyOpen({ parent: null, language: 'en', port: 3002 });
    expect(dialogs.showAlreadyOpen).toHaveBeenCalledWith({ parent: null, language: 'en', port: 3002 });
  });

  test('janela destruída também vai para o nativo', async () => {
    const { screens, dialogs } = setup();
    const win = makeWindow();
    win.destroyed = true;
    await expect(screens.showCrashLoop({ parent: win, language: 'en', dataDir: 'd' })).resolves.toBe('native-choice');
    expect(dialogs.showCrashLoop).toHaveBeenCalled();
  });

  test('se a página não abre em 3 s, usa o nativo e a escolha da tela deixa de valer', async () => {
    const { screens, dialogs, timers, logs } = setup();
    const win = makeWindow({ loadFile: () => new Promise(() => {}) }); // nunca termina de carregar
    const promise = screens.showNoFreePort({ parent: win, language: 'en' });
    expect(dialogs.showNoFreePort).not.toHaveBeenCalled();
    timers.fire();
    await expect(promise).resolves.toBe('native-choice');
    expect(dialogs.showNoFreePort).toHaveBeenCalledTimes(1);
    expect(logs.join('\n')).toMatch(/diálogo nativo/);
    expect(screens.choose('close')).toEqual({ ok: false });
  });

  test('se a página abre a tempo, o temporizador é cancelado e o nativo não aparece', async () => {
    const { screens, dialogs, timers } = setup();
    const promise = screens.showRenderGone({ parent: makeWindow(), language: 'en' });
    expect(timers.pending()).toBe(1);
    screens.getState();
    expect(timers.pending()).toBe(0);
    timers.fire();
    screens.choose('close');
    await promise;
    expect(dialogs.showRenderGone).not.toHaveBeenCalled();
  });

  test('loadFile que falha cai no nativo na hora', async () => {
    const { screens, dialogs } = setup();
    const win = makeWindow({ loadFile: () => Promise.reject(new Error('ERR_FILE_NOT_FOUND')) });
    await expect(screens.showRenderGone({ parent: win, language: 'en' })).resolves.toBe('native-choice');
    expect(dialogs.showRenderGone).toHaveBeenCalled();
  });

  test('loadFile que lança também cai no nativo', async () => {
    const { screens } = setup();
    const win = makeWindow({
      loadFile: () => {
        throw new Error('boom');
      },
    });
    await expect(screens.showRenderGone({ parent: win, language: 'en' })).resolves.toBe('native-choice');
  });

  test('se o nativo falhar, resolve como "close" (o app não fica preso)', async () => {
    const { screens, dialogs } = setup();
    dialogs.showRenderGone.mockRejectedValue(new Error('x'));
    await expect(screens.showRenderGone({ parent: null, language: 'en' })).rejects.toThrow('x'); // sem janela: devolve o nativo como está
    const win = makeWindow({ loadFile: () => Promise.reject(new Error('x')) });
    await expect(screens.showRenderGone({ parent: win, language: 'en' })).resolves.toBe('close');
  });

  test('showStageMissing continua nativo', async () => {
    const { screens, dialogs } = setup();
    await expect(screens.showStageMissing({ language: 'en' })).resolves.toBe('native-choice');
    expect(dialogs.showStageMissing).toHaveBeenCalledWith({ language: 'en' });
  });
});

describe('screens: carregamento e estado inicial', () => {
  test('sem tela, a página recebe o estado de carregamento', () => {
    const { screens } = setup();
    expect(screens.getState()).toMatchObject({ kind: 'loading', buttons: [] });
  });

  test('showLoading volta ao carregamento e avisa a página aberta', async () => {
    const { screens } = setup();
    const win = makeWindow({ url: LOADING_URL });
    screens.getState();
    const promise = screens.showRenderGone({ parent: win, language: 'en' });
    screens.choose('close');
    await promise;
    win.sent.length = 0;
    screens.showLoading(win);
    await flush();
    expect(screens.getState().kind).toBe('loading');
    expect(win.sent).toEqual([[SCREEN_STATE_CHANNEL, expect.objectContaining({ kind: 'loading' })]]);
  });
});
