'use strict';

const https = require('https');
const { EventEmitter } = require('events');
const { createUpdater, detectMode, fetchLatestRelease, AUTO_CHECK_DELAY_MS } = require('../src/updater');
const { makeAutoUpdater, makeDeps, flush } = require('./helpers/fakeUpdaterDeps');

const RELEASE_URL = 'https://github.com/GregoryCardoso/skins-manager/releases/tag/v1.1.0';
const AVAILABLE = { isUpdateAvailable: true, updateInfo: { version: '1.1.0', releaseNotes: '<p>Novidades</p>' } };
const NOT_AVAILABLE = { isUpdateAvailable: false, updateInfo: { version: '1.0.0' } };

describe('detectMode', () => {
  test('dev, instalador e portátil', () => {
    expect(detectMode({ isPackaged: false, env: {} })).toBe('dev');
    expect(detectMode({ isPackaged: false, env: { PORTABLE_EXECUTABLE_FILE: 'x' } })).toBe('dev');
    expect(detectMode({ isPackaged: true, env: {} })).toBe('installer');
    expect(detectMode({ isPackaged: true, env: undefined })).toBe('installer');
    expect(detectMode({ isPackaged: true, env: { PORTABLE_EXECUTABLE_FILE: 'C:\\x.exe' } })).toBe('portable');
    expect(detectMode({ isPackaged: true, env: { PORTABLE_EXECUTABLE_FILE: '' } })).toBe('installer');
  });
});

describe('modo e dev', () => {
  test('dev: status disabled, sem carregar o autoUpdater, sem timer', async () => {
    const { deps, autoUpdater } = makeDeps({ app: { isPackaged: false } });
    const updater = createUpdater(deps);
    expect(updater.mode).toBe('dev');
    expect(await updater.check({ manual: true })).toEqual({ mode: 'dev', currentVersion: '1.0.0', status: 'disabled' });
    updater.scheduleAutoCheck();
    expect(deps.setTimeoutFn).not.toHaveBeenCalled();
    expect(deps.loadAutoUpdater).not.toHaveBeenCalled();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(deps.fetchLatest).not.toHaveBeenCalled();
  });

  test('modos via env injetado', () => {
    expect(createUpdater(makeDeps().deps).mode).toBe('installer');
    expect(createUpdater(makeDeps({ deps: { env: { PORTABLE_EXECUTABLE_FILE: 'x' } } }).deps).mode).toBe('portable');
  });
});

describe('flags do autoUpdater (D181)', () => {
  test('todas false e logger redirecionado', async () => {
    const { deps, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(NOT_AVAILABLE);
    await createUpdater(deps).check({ manual: true });
    expect(autoUpdater.autoDownload).toBe(false);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
    expect(autoUpdater.allowPrerelease).toBe(false);
    expect(autoUpdater.allowDowngrade).toBe(false);
    autoUpdater.logger.info('a');
    autoUpdater.logger.error('b');
    expect(deps.logger.info).toHaveBeenCalledWith('[updater] a');
    expect(deps.logger.error).toHaveBeenCalledWith('[updater] b');
  });

  test('autoUpdater é carregado uma vez só, e de forma preguiçosa', async () => {
    const { deps, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(NOT_AVAILABLE);
    const updater = createUpdater(deps);
    expect(deps.loadAutoUpdater).not.toHaveBeenCalled();
    await updater.check({ manual: true });
    await updater.check({ manual: true });
    expect(deps.loadAutoUpdater).toHaveBeenCalledTimes(1);
  });

  test('progresso do download vai para a barra da janela, limitado a 0..1', async () => {
    const { deps, autoUpdater, win } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(NOT_AVAILABLE);
    await createUpdater(deps).check({ manual: true });
    autoUpdater.emit('download-progress', { percent: 50 });
    autoUpdater.emit('download-progress', { percent: 250 });
    autoUpdater.emit('download-progress', { percent: -5 });
    autoUpdater.emit('download-progress', {});
    expect(win.setProgressBar.mock.calls.map((c) => c[0])).toEqual([0.5, 1, 0, 0]);
  });
});

describe('verificação automática', () => {
  test('agenda uma vez, em 10 s, com unref', () => {
    const unref = jest.fn();
    const { deps } = makeDeps({ deps: { setTimeoutFn: jest.fn(() => ({ unref })) } });
    createUpdater(deps).scheduleAutoCheck();
    expect(deps.setTimeoutFn).toHaveBeenCalledTimes(1);
    expect(deps.setTimeoutFn.mock.calls[0][1]).toBe(10000);
    expect(AUTO_CHECK_DELAY_MS).toBe(10000);
    expect(unref).toHaveBeenCalled();
  });

  test('com timers falsos do Jest, só dispara aos 10 s e uma vez', async () => {
    jest.useFakeTimers();
    try {
      const { deps, autoUpdater } = makeDeps({ deps: { setTimeoutFn: setTimeout } });
      autoUpdater.checkForUpdates.mockResolvedValue(NOT_AVAILABLE);
      createUpdater(deps).scheduleAutoCheck();
      await jest.advanceTimersByTimeAsync(9999);
      expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('erro na automática: só log, sem diálogo', async () => {
    let fire;
    const { deps, autoUpdater, dialogs } = makeDeps({ deps: { setTimeoutFn: jest.fn((fn) => ((fire = fn), {})) } });
    autoUpdater.checkForUpdates.mockRejectedValue(new Error('sem rede'));
    createUpdater(deps).scheduleAutoCheck();
    fire();
    await flush();
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('automática'));
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('sem rede'));
    for (const fn of Object.values(dialogs)) expect(fn).not.toHaveBeenCalled();
  });

  test('automática com versão nova abre o primeiro diálogo (instalador)', async () => {
    let fire;
    const { deps, autoUpdater, dialogs } = makeDeps({ deps: { setTimeoutFn: jest.fn((fn) => ((fire = fn), {})) } });
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    createUpdater(deps).scheduleAutoCheck();
    fire();
    await flush();
    expect(dialogs.showUpdateAvailable).toHaveBeenCalledTimes(1);
  });

  test('erro na manual devolve status error (e registra no log)', async () => {
    const { deps, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockRejectedValue(new Error('boom'));
    const res = await createUpdater(deps).check({ manual: true });
    expect(res).toEqual({ mode: 'installer', currentVersion: '1.0.0', status: 'error' });
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('manual'));
  });
});

describe('fluxo do instalador', () => {
  test('sem versão nova: up-to-date, sem diálogo', async () => {
    const { deps, autoUpdater, dialogs } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(NOT_AVAILABLE);
    const res = await createUpdater(deps).check({ manual: true });
    expect(res).toMatchObject({ status: 'up-to-date', latestVersion: '1.0.0' });
    expect(dialogs.showUpdateAvailable).not.toHaveBeenCalled();
  });

  test('resultado nulo do electron-updater vira up-to-date', async () => {
    const { deps, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(null);
    expect(await createUpdater(deps).check({ manual: true })).toMatchObject({ status: 'up-to-date' });
  });

  test('"Agora não": não baixa, não reinicia e não instala ao fechar', async () => {
    const { deps, autoUpdater, dialogs, calls } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    dialogs.showUpdateAvailable.mockResolvedValue('later');
    const updater = createUpdater(deps);
    const res = await updater.check({ manual: true });
    expect(res).toMatchObject({ status: 'available', latestVersion: '1.1.0' });
    await flush();
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(dialogs.showUpdateReady).not.toHaveBeenCalled();
    expect(updater.installPendingOnQuit()).toBe(false);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  test('resposta inesperada do diálogo é tratada como "Agora não"', async () => {
    const { deps, autoUpdater, dialogs } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    dialogs.showUpdateAvailable.mockResolvedValue(undefined);
    await createUpdater(deps).check({ manual: true });
    await flush();
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  test('nada é baixado antes de o diálogo responder', async () => {
    const { deps, autoUpdater, dialogs } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    let answer;
    dialogs.showUpdateAvailable.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    await createUpdater(deps).check({ manual: true });
    await flush();
    expect(dialogs.showUpdateAvailable).toHaveBeenCalledTimes(1);
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    answer('later');
    await flush();
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  test('o diálogo recebe versões, notas em texto simples e idioma', async () => {
    const { deps, autoUpdater, dialogs } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    await createUpdater(deps).check({ manual: true });
    await flush();
    expect(dialogs.showUpdateAvailable).toHaveBeenCalledWith(
      expect.objectContaining({ version: '1.1.0', current: '1.0.0', notes: 'Novidades', language: 'pt-BR' })
    );
  });

  test('baixar + "Reiniciar agora": stopBackend ANTES de quitAndInstall', async () => {
    const { deps, autoUpdater, dialogs, calls } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    dialogs.showUpdateAvailable.mockResolvedValue('download');
    dialogs.showUpdateReady.mockResolvedValue('restart');
    await createUpdater(deps).check({ manual: true });
    await flush();
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(dialogs.showUpdateReady).toHaveBeenCalledWith(expect.objectContaining({ version: '1.1.0' }));
    expect(calls).toEqual([['stopBackend'], ['quitAndInstall', false, true]]);
  });

  test('o reinício espera o stopBackend terminar (assíncrono)', async () => {
    const order = [];
    let release;
    const { deps, autoUpdater, dialogs } = makeDeps();
    deps.stopBackend = jest.fn(
      () =>
        new Promise((resolve) => {
          order.push('stop-start');
          release = () => {
            order.push('stop-end');
            resolve();
          };
        })
    );
    autoUpdater.quitAndInstall.mockImplementation(() => order.push('quit'));
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    dialogs.showUpdateAvailable.mockResolvedValue('download');
    dialogs.showUpdateReady.mockResolvedValue('restart');
    await createUpdater(deps).check({ manual: true });
    await flush();
    expect(order).toEqual(['stop-start']);
    release();
    await flush();
    expect(order).toEqual(['stop-start', 'stop-end', 'quit']);
  });

  test('"Instalar ao fechar": não reinicia agora; installPendingOnQuit instala uma vez', async () => {
    const { deps, autoUpdater, dialogs, calls } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    dialogs.showUpdateAvailable.mockResolvedValue('download');
    dialogs.showUpdateReady.mockResolvedValue('on-quit');
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    await flush();
    expect(calls).toEqual([]);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.installPendingOnQuit()).toBe(true);
    expect(calls).toEqual([['quitAndInstall', true, false]]);
    expect(updater.installPendingOnQuit()).toBe(false);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test('fechar o diálogo de "pronta" (resposta fora de restart) segue como instalar ao fechar', async () => {
    const { deps, autoUpdater, dialogs } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    dialogs.showUpdateAvailable.mockResolvedValue('download');
    dialogs.showUpdateReady.mockResolvedValue(undefined);
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    await flush();
    expect(updater.installPendingOnQuit()).toBe(true);
  });

  test('installPendingOnQuit sem nada baixado não instala', () => {
    const { deps, autoUpdater } = makeDeps();
    const updater = createUpdater(deps);
    expect(updater.installPendingOnQuit()).toBe(false);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(deps.loadAutoUpdater).not.toHaveBeenCalled();
  });

  test('installPendingOnQuit: falha do quitAndInstall é engolida e registrada', async () => {
    const { deps, autoUpdater, dialogs } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    dialogs.showUpdateAvailable.mockResolvedValue('download');
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    await flush();
    autoUpdater.quitAndInstall.mockImplementation(() => {
      throw new Error('falhou');
    });
    expect(updater.installPendingOnQuit()).toBe(false);
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('falhou'));
  });

  test('falha no download: mostra erro, limpa a barra e não pergunta de reiniciar', async () => {
    const au = makeAutoUpdater({ checkResult: AVAILABLE, downloadError: new Error('disco cheio') });
    const { deps, dialogs, win } = makeDeps({ autoUpdater: au });
    dialogs.showUpdateAvailable.mockResolvedValue('download');
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    await flush();
    expect(dialogs.showUpdateError).toHaveBeenCalledWith(expect.objectContaining({ reason: 'disco cheio' }));
    expect(dialogs.showUpdateReady).not.toHaveBeenCalled();
    expect(win.setProgressBar).toHaveBeenLastCalledWith(-1);
    expect(updater.installPendingOnQuit()).toBe(false);
  });

  test('depois de baixada, nova verificação manual devolve ready e reabre o pedido de reinício', async () => {
    const { deps, autoUpdater, dialogs, calls } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    dialogs.showUpdateAvailable.mockResolvedValue('download');
    dialogs.showUpdateReady.mockResolvedValueOnce('on-quit').mockResolvedValueOnce('restart');
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    await flush();
    autoUpdater.checkForUpdates.mockClear();
    const res = await updater.check({ manual: true });
    expect(res).toMatchObject({ status: 'ready', latestVersion: '1.1.0' });
    await flush();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(dialogs.showUpdateReady).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([['stopBackend'], ['quitAndInstall', false, true]]);
  });

  test('verificação automática depois de baixada não reabre diálogo', async () => {
    const { deps, autoUpdater, dialogs } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    dialogs.showUpdateAvailable.mockResolvedValue('download');
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    await flush();
    dialogs.showUpdateReady.mockClear();
    expect(await updater.check({ manual: false })).toMatchObject({ status: 'ready' });
    await flush();
    expect(dialogs.showUpdateReady).not.toHaveBeenCalled();
  });
});

describe('concorrência', () => {
  test('segunda verificação durante a primeira devolve busy', async () => {
    const { deps, autoUpdater } = makeDeps();
    let resolveCheck;
    autoUpdater.checkForUpdates.mockImplementation(() => new Promise((resolve) => (resolveCheck = resolve)));
    const updater = createUpdater(deps);
    const first = updater.check({ manual: true });
    await flush();
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'busy' });
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    resolveCheck(NOT_AVAILABLE);
    expect(await first).toMatchObject({ status: 'up-to-date' });
    // liberado depois
    autoUpdater.checkForUpdates.mockResolvedValue(NOT_AVAILABLE);
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'up-to-date' });
  });

  test('enquanto o diálogo está aberto (fluxo ativo) devolve busy', async () => {
    const { deps, autoUpdater, dialogs } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    let answer;
    dialogs.showUpdateAvailable.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    await flush();
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'busy' });
    answer('later');
    await flush();
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'available' });
  });

  test('erro dentro do fluxo em segundo plano não vira rejeição solta e libera o fluxo', async () => {
    const { deps, autoUpdater, dialogs } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    dialogs.showUpdateAvailable.mockRejectedValue(new Error('diálogo quebrou'));
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    await flush();
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('diálogo quebrou'));
    autoUpdater.checkForUpdates.mockResolvedValue(NOT_AVAILABLE);
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'up-to-date' });
  });
});

describe('portátil', () => {
  const portable = (extra = {}) =>
    makeDeps({ deps: { env: { PORTABLE_EXECUTABLE_FILE: 'C:\\SkinsManager-Portable.exe' }, ...extra } });

  test('nunca carrega o electron-updater', async () => {
    const { deps, dialogs } = portable();
    deps.fetchLatest.mockResolvedValue({ tag_name: 'v1.1.0', html_url: RELEASE_URL, body: 'x' });
    dialogs.showPortableUpdate.mockResolvedValue('close');
    await createUpdater(deps).check({ manual: true });
    await flush();
    expect(deps.loadAutoUpdater).not.toHaveBeenCalled();
  });

  test('versão nova + "Abrir página": openExternal só com a URL validada', async () => {
    const { deps, dialogs, shell } = portable();
    deps.fetchLatest.mockResolvedValue({ tag_name: 'v1.1.0', html_url: RELEASE_URL, body: '<b>n</b>' });
    dialogs.showPortableUpdate.mockResolvedValue('open');
    const res = await createUpdater(deps).check({ manual: true });
    expect(res).toMatchObject({ mode: 'portable', status: 'available', latestVersion: '1.1.0' });
    await flush();
    expect(dialogs.showPortableUpdate).toHaveBeenCalledWith(expect.objectContaining({ version: '1.1.0', current: '1.0.0', notes: 'n' }));
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
    expect(shell.openExternal).toHaveBeenCalledWith(RELEASE_URL);
  });

  test('"Fechar": não abre nada', async () => {
    const { deps, dialogs, shell } = portable();
    deps.fetchLatest.mockResolvedValue({ tag_name: 'v1.1.0', html_url: RELEASE_URL });
    dialogs.showPortableUpdate.mockResolvedValue('close');
    await createUpdater(deps).check({ manual: true });
    await flush();
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  test.each([
    ['URL de outro repositório', 'https://github.com/GregoryCardoso/skins-manager-evil/releases/tag/v9'],
    ['URL com @', 'https://github.com@evil.com/GregoryCardoso/skins-manager/releases/x'],
    ['http', 'http://github.com/GregoryCardoso/skins-manager/releases/tag/v9'],
    ['javascript', 'javascript:alert(1)'],
  ])('%s: status error, sem diálogo e sem openExternal', async (_n, url) => {
    const { deps, dialogs, shell } = portable();
    deps.fetchLatest.mockResolvedValue({ tag_name: 'v9.0.0', html_url: url });
    const res = await createUpdater(deps).check({ manual: true });
    await flush();
    expect(res.status).toBe('error');
    expect(dialogs.showPortableUpdate).not.toHaveBeenCalled();
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  test('igual, mais antiga, rascunho e pré-release: nunca oferece', async () => {
    for (const json of [
      { tag_name: 'v1.0.0', html_url: RELEASE_URL },
      { tag_name: 'v0.5.0', html_url: RELEASE_URL },
    ]) {
      const { deps, dialogs } = portable();
      deps.fetchLatest.mockResolvedValue(json);
      expect((await createUpdater(deps).check({ manual: true })).status).toBe('up-to-date');
      expect(dialogs.showPortableUpdate).not.toHaveBeenCalled();
    }
    for (const json of [
      { tag_name: 'v2.0.0', html_url: RELEASE_URL, draft: true },
      { tag_name: 'v2.0.0', html_url: RELEASE_URL, prerelease: true },
      null,
      {},
    ]) {
      const { deps, dialogs } = portable();
      deps.fetchLatest.mockResolvedValue(json);
      expect((await createUpdater(deps).check({ manual: true })).status).toBe('error');
      expect(dialogs.showPortableUpdate).not.toHaveBeenCalled();
    }
  });

  test('falha de rede: manual vira error; automática só registra', async () => {
    const { deps, dialogs } = portable();
    deps.fetchLatest.mockRejectedValue(new Error('HTTP 403'));
    const updater = createUpdater(deps);
    expect((await updater.check({ manual: true })).status).toBe('error');
    expect(await updater.check({ manual: false })).toMatchObject({ status: 'error' });
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('HTTP 403'));
    expect(dialogs.showPortableUpdate).not.toHaveBeenCalled();
  });
});

describe('fetchLatestRelease (https real simulado)', () => {
  let getSpy;
  afterEach(() => {
    if (getSpy) getSpy.mockRestore();
    getSpy = null;
  });

  // Instala um https.get falso. `script(response, request)` conduz a resposta.
  function stubGet(statusCode, script) {
    const captured = {};
    getSpy = jest.spyOn(https, 'get').mockImplementation((url, options, callback) => {
      captured.url = url;
      captured.options = options;
      const request = new EventEmitter();
      request.destroy = jest.fn((err) => {
        request.destroyed = true;
        if (err) setImmediate(() => request.emit('error', err));
      });
      const response = new EventEmitter();
      response.statusCode = statusCode;
      response.resume = jest.fn();
      captured.request = request;
      captured.response = response;
      setImmediate(() => {
        if (statusCode !== undefined) callback(response);
        if (script) script(response, request);
      });
      return request;
    });
    return captured;
  }

  test('200 com JSON válido; usa a URL da API, User-Agent e timeout de 10 s', async () => {
    const cap = stubGet(200, (res) => {
      res.emit('data', Buffer.from('{"tag_name":'));
      res.emit('data', Buffer.from('"v1.2.3"}'));
      res.emit('end');
    });
    await expect(fetchLatestRelease()).resolves.toEqual({ tag_name: 'v1.2.3' });
    expect(cap.url).toBe('https://api.github.com/repos/GregoryCardoso/skins-manager/releases/latest');
    expect(cap.options.timeout).toBe(10000);
    expect(cap.options.headers['User-Agent']).toBeTruthy();
  });

  test.each([201, 204, 301, 302, 403, 404, 500])('status %i é recusado e a resposta é descartada', async (status) => {
    const cap = stubGet(status);
    await expect(fetchLatestRelease()).rejects.toThrow(`HTTP ${status}`);
    expect(cap.response.resume).toHaveBeenCalled();
  });

  test('corpo acima de 256 KB: aborta a requisição', async () => {
    const cap = stubGet(200, (res) => {
      res.emit('data', Buffer.alloc(256 * 1024 + 1, 0x61));
    });
    await expect(fetchLatestRelease()).rejects.toThrow(/grande demais/);
    expect(cap.request.destroy).toHaveBeenCalled();
  });

  test('exatamente 256 KB ainda é aceito (limite é "maior que")', async () => {
    // JSON válido com exatamente 256 KB
    const filler = 'a'.repeat(256 * 1024 - '{"x":""}'.length);
    stubGet(200, (res) => {
      res.emit('data', Buffer.from(`{"x":"${filler}"}`));
      res.emit('end');
    });
    await expect(fetchLatestRelease()).resolves.toMatchObject({ x: expect.any(String) });
  });

  test('vários pedaços que somam mais que 256 KB também abortam', async () => {
    const cap = stubGet(200, (res) => {
      for (let i = 0; i < 5; i += 1) res.emit('data', Buffer.alloc(64 * 1024, 0x61));
    });
    await expect(fetchLatestRelease()).rejects.toThrow(/grande demais/);
    expect(cap.request.destroy).toHaveBeenCalled();
  });

  test('JSON inválido rejeita', async () => {
    stubGet(200, (res) => {
      res.emit('data', Buffer.from('<html>'));
      res.emit('end');
    });
    await expect(fetchLatestRelease()).rejects.toThrow(/JSON inválido/);
  });

  test('timeout destrói a requisição e rejeita', async () => {
    const cap = stubGet(undefined, (_res, req) => req.emit('timeout'));
    await expect(fetchLatestRelease()).rejects.toThrow(/Tempo esgotado/);
    expect(cap.request.destroy).toHaveBeenCalled();
  });

  test('erro de rede rejeita', async () => {
    stubGet(undefined, (_res, req) => req.emit('error', new Error('ECONNRESET')));
    await expect(fetchLatestRelease()).rejects.toThrow('ECONNRESET');
  });
});
