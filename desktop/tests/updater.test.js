'use strict';

const https = require('https');
const { EventEmitter } = require('events');
const { createUpdater, detectMode, fetchLatestRelease, fetchJson, AUTO_CHECK_DELAY_MS } = require('../src/updater');
const { makeAutoUpdater, makeDeps, flush, answer, downloadToReady } = require('./helpers/fakeUpdaterDeps');

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
    expect(updater.getState().phase).toBe('idle');
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

  test('erro na automática: só log, nenhum estado publicado', async () => {
    let fire;
    const { deps, autoUpdater, states } = makeDeps({ deps: { setTimeoutFn: jest.fn((fn) => ((fire = fn), {})) } });
    autoUpdater.checkForUpdates.mockRejectedValue(new Error('sem rede'));
    createUpdater(deps).scheduleAutoCheck();
    fire();
    await flush();
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('automática'));
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('sem rede'));
    expect(states).toEqual([]);
  });

  test('automática com versão nova publica o estado available (instalador)', async () => {
    let fire;
    const { deps, autoUpdater, states } = makeDeps({ deps: { setTimeoutFn: jest.fn((fn) => ((fire = fn), {})) } });
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    createUpdater(deps).scheduleAutoCheck();
    fire();
    await flush();
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ phase: 'available', version: '1.1.0' });
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
  test('sem versão nova: up-to-date, nenhum estado publicado', async () => {
    const { deps, autoUpdater, states } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(NOT_AVAILABLE);
    const res = await createUpdater(deps).check({ manual: true });
    expect(res).toMatchObject({ status: 'up-to-date', latestVersion: '1.0.0' });
    expect(states).toEqual([]);
  });

  test('resultado nulo do electron-updater vira up-to-date', async () => {
    const { deps, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(null);
    expect(await createUpdater(deps).check({ manual: true })).toMatchObject({ status: 'up-to-date' });
  });

  test('o estado available leva versões e notas, e nunca uma URL', async () => {
    const { deps, autoUpdater, states } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    const res = await updater.check({ manual: true });
    expect(res).toMatchObject({ status: 'available', latestVersion: '1.1.0' });
    expect(states[0]).toEqual({
      seq: 1,
      phase: 'available',
      mode: 'installer',
      version: '1.1.0',
      currentVersion: '1.0.0',
      notes: 'Novidades',
      percent: null,
      error: null,
    });
    expect(JSON.stringify(states)).not.toMatch(/https?:/);
    expect(updater.getState()).toBe(states[0]);
  });

  test('"Agora não": não baixa, não reinicia e não instala ao fechar; a próxima verificação oferece de novo', async () => {
    const { deps, autoUpdater, calls } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    expect(answer(updater, 'later')).toMatchObject({ accepted: true, state: { phase: 'idle' } });
    await flush();
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.installPendingOnQuit()).toBe(false);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'available' });
    expect(updater.getState().phase).toBe('available');
  });

  test('nada é baixado enquanto o usuário não responde; fechar o app com o aviso aberto não instala', async () => {
    const { deps, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    await flush();
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.installPendingOnQuit()).toBe(false);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  test('fluxo completo: available -> downloading (progresso limitado) -> ready -> restart', async () => {
    const { deps, autoUpdater, states, win, calls, clock } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    let finish;
    autoUpdater.downloadUpdate.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    expect(answer(updater, 'download')).toMatchObject({ accepted: true, state: { phase: 'downloading', percent: 0 } });
    await flush();
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);

    // 1 envio por ponto percentual: 10.2 e 10.9 são o mesmo ponto
    clock.now += 300;
    autoUpdater.emit('download-progress', { percent: 10.2 });
    clock.now += 50;
    autoUpdater.emit('download-progress', { percent: 10.9 });
    // no máximo 4 por segundo: o ponto 11 chega 100 ms depois do último envio e é descartado
    clock.now += 50;
    autoUpdater.emit('download-progress', { percent: 11 });
    clock.now += 250;
    autoUpdater.emit('download-progress', { percent: 12 });
    expect(states.filter((s) => s.phase === 'downloading').map((s) => s.percent)).toEqual([0, 10, 12]);
    // a barra de tarefas recebe todos os eventos
    expect(win.setProgressBar.mock.calls.map((c) => c[0])).toEqual([0.102, 0.109, 0.11, 0.12]);

    finish([]);
    await flush();
    expect(win.setProgressBar).toHaveBeenLastCalledWith(-1);
    expect(updater.getState()).toMatchObject({ phase: 'ready', version: '1.1.0', percent: null });

    expect(answer(updater, 'restart')).toMatchObject({ accepted: true, state: { phase: 'installing' } });
    await flush();
    expect(calls).toEqual([['stopBackend'], ['quitAndInstall', true, true]]);
    const seqs = states.map((s) => s.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  test('progresso fora da fase downloading não gera estado', async () => {
    const { deps, autoUpdater, states } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    const before = states.length;
    autoUpdater.emit('download-progress', { percent: 50 });
    expect(states).toHaveLength(before);
  });

  test('quitAndInstall lançando depois do stopBackend: religa o backend e publica error/install', async () => {
    const restartBackend = jest.fn(async () => {});
    const { deps, autoUpdater, calls } = makeDeps({ deps: { restartBackend } });
    autoUpdater.quitAndInstall.mockImplementation(() => {
      throw new Error('instalador indisponível');
    });
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    answer(updater, 'restart');
    await flush();
    expect(calls).toEqual([['stopBackend']]);
    expect(restartBackend).toHaveBeenCalledTimes(1);
    expect(updater.getState()).toMatchObject({ phase: 'error', error: { kind: 'install', detail: 'instalador indisponível' } });
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('instalador indisponível'));
  });

  test('religar o backend também falhando: o erro de instalação ainda é publicado', async () => {
    const restartBackend = jest.fn(async () => {
      throw new Error('sem supervisor');
    });
    const { deps, autoUpdater } = makeDeps({ deps: { restartBackend } });
    autoUpdater.quitAndInstall.mockImplementation(() => {
      throw new Error('falhou');
    });
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    answer(updater, 'restart');
    await flush();
    expect(updater.getState()).toMatchObject({ phase: 'error', error: { kind: 'install' } });
  });

  test('o reinício espera o stopBackend terminar (assíncrono)', async () => {
    const order = [];
    let release;
    const { deps, autoUpdater } = makeDeps();
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
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    answer(updater, 'restart');
    await flush();
    expect(order).toEqual(['stop-start']);
    expect(updater.getState().phase).toBe('installing');
    release();
    await flush();
    expect(order).toEqual(['stop-start', 'stop-end', 'quit']);
  });

  test('stopBackend lançando: quitAndInstall NÃO é chamado, o erro fica no log e no estado', async () => {
    const { deps, autoUpdater } = makeDeps({
      deps: {
        stopBackend: async () => {
          throw new Error('stop falhou');
        },
      },
    });
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    answer(updater, 'restart');
    await flush();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('stop falhou'));
    expect(updater.getState()).toMatchObject({ phase: 'error', error: { kind: 'install', detail: 'stop falhou' } });
  });

  test('"Instalar ao fechar": não reinicia agora; installPendingOnQuit instala uma vez', async () => {
    const { deps, autoUpdater, calls } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    expect(answer(updater, 'installOnQuit')).toMatchObject({ accepted: true, state: { phase: 'idle' } });
    expect(calls).toEqual([]);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.installPendingOnQuit()).toBe(true);
    expect(calls).toEqual([['quitAndInstall', true, false]]);
    expect(updater.installPendingOnQuit()).toBe(false);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test('V102-Q2: fechar o app em ready sem escolher NÃO instala', async () => {
    const { deps, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    expect(updater.getState().phase).toBe('ready');
    expect(updater.installPendingOnQuit()).toBe(false);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  test('fechar o app durante o download ou com o aviso aberto não instala', async () => {
    const { deps, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    autoUpdater.downloadUpdate.mockImplementation(() => new Promise(() => {}));
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    expect(updater.installPendingOnQuit()).toBe(false);
    answer(updater, 'download');
    await flush();
    expect(updater.getState().phase).toBe('downloading');
    expect(updater.installPendingOnQuit()).toBe(false);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  test('"Reiniciar agora" depois de "instalar ao fechar" não instala de novo no before-quit', async () => {
    const { deps, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    answer(updater, 'installOnQuit');
    await updater.check({ manual: true }); // reabre
    answer(updater, 'restart');
    await flush();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(updater.installPendingOnQuit()).toBe(false);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test('installPendingOnQuit sem nada baixado não instala', () => {
    const { deps, autoUpdater } = makeDeps();
    const updater = createUpdater(deps);
    expect(updater.installPendingOnQuit()).toBe(false);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(deps.loadAutoUpdater).not.toHaveBeenCalled();
  });

  test('installPendingOnQuit: falha do quitAndInstall é engolida e registrada', async () => {
    const { deps, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    answer(updater, 'installOnQuit');
    autoUpdater.quitAndInstall.mockImplementation(() => {
      throw new Error('falhou');
    });
    expect(updater.installPendingOnQuit()).toBe(false);
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('falhou'));
  });

  test('falha no download: error/download no estado, barra limpa, nada para instalar', async () => {
    const au = makeAutoUpdater({ checkResult: AVAILABLE, downloadError: new Error('disco cheio') });
    const { deps, win } = makeDeps({ autoUpdater: au });
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    answer(updater, 'download');
    await flush();
    expect(updater.getState()).toMatchObject({ phase: 'error', error: { kind: 'download', detail: 'disco cheio' } });
    expect(win.setProgressBar).toHaveBeenLastCalledWith(-1);
    expect(updater.installPendingOnQuit()).toBe(false);
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('disco cheio'));
    // "Fechar" o erro volta a idle, e uma nova verificação oferece a versão de novo
    answer(updater, 'dismiss');
    expect(updater.getState().phase).toBe('idle');
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'available' });
  });

  test('nova verificação com o erro de download na tela limpa o erro', async () => {
    const au = makeAutoUpdater({ checkResult: NOT_AVAILABLE, downloadError: new Error('x') });
    const { deps, states } = makeDeps({ autoUpdater: au });
    au.checkForUpdates.mockResolvedValueOnce(AVAILABLE).mockResolvedValue(NOT_AVAILABLE);
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    answer(updater, 'download');
    await flush();
    expect(updater.getState().phase).toBe('error');
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'up-to-date' });
    expect(updater.getState().phase).toBe('idle');
    expect(states.at(-1).error).toBeNull();
  });

  test('depois de baixada, a verificação manual devolve ready e reabre o modal (novo seq)', async () => {
    const { deps, autoUpdater, calls } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    const seqBefore = updater.getState().seq;
    autoUpdater.checkForUpdates.mockClear();

    // o usuário só escondeu o modal (X/Esc): a fase continua ready, e a verificação manual muda o seq
    const res = await updater.check({ manual: true });
    expect(res).toMatchObject({ status: 'ready', latestVersion: '1.1.0' });
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.getState()).toMatchObject({ phase: 'ready', version: '1.1.0' });
    expect(updater.getState().seq).toBeGreaterThan(seqBefore);

    // depois de "instalar ao fechar" (fase idle) a verificação manual também volta a ready
    answer(updater, 'installOnQuit');
    expect(updater.getState().phase).toBe('idle');
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'ready' });
    expect(updater.getState().phase).toBe('ready');

    answer(updater, 'restart');
    await flush();
    expect(calls).toEqual([['stopBackend'], ['quitAndInstall', true, true]]);
  });

  test('depois de erro de instalação, a verificação manual volta a ready', async () => {
    const { deps, autoUpdater } = makeDeps({ deps: { restartBackend: async () => {} } });
    autoUpdater.quitAndInstall.mockImplementation(() => {
      throw new Error('x');
    });
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    answer(updater, 'restart');
    await flush();
    expect(updater.getState().phase).toBe('error');
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'ready' });
    expect(updater.getState()).toMatchObject({ phase: 'ready', error: null });
  });

  test('verificação automática depois de baixada não reabre o modal', async () => {
    const { deps, autoUpdater, states } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    const count = states.length;
    expect(await updater.check({ manual: false })).toMatchObject({ status: 'ready' });
    expect(states).toHaveLength(count);
  });
});

describe('respond: respostas inválidas são ignoradas', () => {
  async function availableUpdater() {
    const made = makeDeps();
    made.autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(made.deps);
    await updater.check({ manual: true });
    return { ...made, updater };
  }

  test('ação de outra fase', async () => {
    const { updater, autoUpdater } = await availableUpdater();
    const before = updater.getState();
    for (const action of ['restart', 'installOnQuit', 'dismiss', 'openDownloadPage']) {
      expect(updater.respond({ action, seq: before.seq })).toEqual({ accepted: false, state: before });
    }
    expect(updater.getState()).toBe(before);
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  test('seq velho (clique repetido) e seq futuro', async () => {
    const { updater, autoUpdater } = await availableUpdater();
    const seq = updater.getState().seq;
    expect(updater.respond({ action: 'download', seq: seq - 1 }).accepted).toBe(false);
    expect(updater.respond({ action: 'download', seq: seq + 1 }).accepted).toBe(false);
    expect(updater.respond({ action: 'download', seq }).accepted).toBe(true);
    // o mesmo clique de novo: o seq mudou e a fase também
    expect(updater.respond({ action: 'download', seq }).accepted).toBe(false);
    await flush();
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  test.each([[null], [undefined], ['download'], [42], [[]], [{}], [{ action: 'download' }], [{ action: 'download', seq: '1' }], [{ action: 'formatar', seq: 1 }], [{ action: 'download', seq: 1.5 }]])(
    'payload %j',
    async (payload) => {
      const { updater, autoUpdater } = await availableUpdater();
      expect(updater.respond(payload).accepted).toBe(false);
      expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
      expect(updater.getState().phase).toBe('available');
    }
  );

  test('nas fases idle, downloading e installing nenhuma ação é aceita', async () => {
    const { updater, autoUpdater } = await availableUpdater();
    answer(updater, 'later');
    for (const action of ['download', 'later', 'restart', 'installOnQuit', 'dismiss', 'openDownloadPage']) {
      expect(answer(updater, action).accepted).toBe(false);
    }
    await updater.check({ manual: true });
    autoUpdater.downloadUpdate.mockImplementation(() => new Promise(() => {}));
    answer(updater, 'download');
    await flush();
    expect(updater.getState().phase).toBe('downloading');
    for (const action of ['download', 'later', 'restart', 'installOnQuit', 'dismiss', 'openDownloadPage']) {
      expect(answer(updater, action).accepted).toBe(false);
    }
  });
});

describe('concorrência (busy)', () => {
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

  test('durante a busca das notas (checking) devolve busy', async () => {
    const { deps, autoUpdater } = makeDeps();
    let finishNotes;
    deps.fetchJson.mockImplementation(() => new Promise((resolve) => (finishNotes = resolve)));
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    const first = updater.check({ manual: true });
    await flush();
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'busy' });
    finishNotes({ tag_name: 'v1.1.0', body: 'ok' });
    expect(await first).toMatchObject({ status: 'available' });
    expect(updater.getState().phase).toBe('available'); // o estado só é publicado depois das notas
  });

  test('com o aviso available aberto devolve busy; depois de "Agora não" volta ao normal', async () => {
    const { deps, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'busy' });
    answer(updater, 'later');
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'available' });
  });

  test('durante o download devolve downloading com o percentual; durante a instalação, busy', async () => {
    const { deps, autoUpdater, clock } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    let finish;
    autoUpdater.downloadUpdate.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    deps.stopBackend = jest.fn(() => new Promise(() => {}));
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    answer(updater, 'download');
    clock.now += 1000;
    autoUpdater.emit('download-progress', { percent: 42 });
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'downloading', percent: 42 });
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    finish([]);
    await flush();
    answer(updater, 'restart');
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'busy' });
  });

  test('erro ao publicar o estado não derruba o fluxo', async () => {
    const { deps, autoUpdater } = makeDeps();
    deps.publishState.mockImplementation(() => {
      throw new Error('janela fechada');
    });
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'available' });
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('janela fechada'));
    expect(updater.getState().phase).toBe('available');
  });
});

describe('notas da versão (D191)', () => {
  const API_URL = 'https://api.github.com/repos/GregoryCardoso/skins-manager/releases/tags/v1.1.0';
  const BODY = '<!-- pt-BR -->\n## Novidades\n- a\n\n<!-- en -->\n## What is new\n- a';

  async function notesFor(json, { reject, fetchedUrl } = {}) {
    const { deps, autoUpdater } = makeDeps();
    if (reject) deps.fetchJson.mockRejectedValue(reject);
    else deps.fetchJson.mockResolvedValue(json);
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    if (fetchedUrl) fetchedUrl(deps.fetchJson);
    return updater.getState().notes;
  }

  test('busca a release pela tag e usa o markdown cru, com os marcadores de idioma', async () => {
    let seen;
    const notes = await notesFor({ tag_name: 'v1.1.0', body: BODY }, { fetchedUrl: (f) => (seen = f.mock.calls) });
    expect(notes).toBe(BODY);
    expect(seen).toEqual([[API_URL]]);
  });

  test.each([
    ['tag diferente', { tag_name: 'v9.9.9', body: 'x' }],
    ['rascunho', { tag_name: 'v1.1.0', body: 'x', draft: true }],
    ['pré-release', { tag_name: 'v1.1.0', body: 'x', prerelease: true }],
    ['sem body', { tag_name: 'v1.1.0' }],
    ['JSON que não é objeto', 'texto'],
    ['null', null],
  ])('%s: usa o texto do feed, sem HTML', async (_n, json) => {
    expect(await notesFor(json)).toBe('Novidades');
  });

  test.each([
    ['timeout', new Error('Tempo esgotado.')],
    ['HTTP 404', new Error('HTTP 404')],
    ['JSON inválido', new Error('JSON inválido.')],
  ])('falha (%s): reserva do feed, a falha vai para o log e o fluxo segue', async (_n, error) => {
    const { deps, autoUpdater } = makeDeps();
    deps.fetchJson.mockRejectedValue(error);
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'available' });
    expect(updater.getState().notes).toBe('Novidades');
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining(error.message));
  });

  test('a reserva do feed tira o HTML e os marcadores de idioma', async () => {
    const { deps, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '1.1.0', releaseNotes: '<p>Oi <b>mundo</b></p><script>alert(1)</script><!-- en -->' },
    });
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    expect(updater.getState().notes).not.toMatch(/[<>]/);
    expect(updater.getState().notes).toContain('Oi mundo');
  });

  test('versão inválida: nenhum fetch e usa o feed', async () => {
    const { deps, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '1.1.0/../../x', releaseNotes: 'feed' },
    });
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    expect(deps.fetchJson).not.toHaveBeenCalled();
    expect(updater.getState().notes).toBe('feed');
  });

  test('corte em 20 000 caracteres, no fim de linha, com reticências', async () => {
    const line = `${'a'.repeat(99)}\n`;
    const notes = await notesFor({ tag_name: 'v1.1.0', body: line.repeat(300) });
    expect(notes.length).toBeLessThanOrEqual(20001);
    expect(notes.endsWith('…')).toBe(true);
    expect(notes.slice(0, -1).endsWith('a')).toBe(true);
  });

  test('a URL buscada nunca sai do estado enviado ao renderer', async () => {
    const { deps, autoUpdater, states } = makeDeps();
    deps.fetchJson.mockResolvedValue({ tag_name: 'v1.1.0', body: 'x', html_url: RELEASE_URL, url: API_URL });
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    await createUpdater(deps).check({ manual: true });
    expect(JSON.stringify(states)).not.toMatch(/github\.com|https?:/);
  });
});

describe('portátil', () => {
  const portable = (extra = {}) =>
    makeDeps({ deps: { env: { PORTABLE_EXECUTABLE_FILE: 'C:\\SkinsManager-Portable.exe' }, ...extra } });

  test('nunca carrega o electron-updater', async () => {
    const { deps } = portable();
    deps.fetchLatest.mockResolvedValue({ tag_name: 'v1.1.0', html_url: RELEASE_URL, body: 'x' });
    await createUpdater(deps).check({ manual: true });
    await flush();
    expect(deps.loadAutoUpdater).not.toHaveBeenCalled();
  });

  test('versão nova: fase portable-available com as notas em markdown e sem a URL', async () => {
    const { deps, states } = portable();
    deps.fetchLatest.mockResolvedValue({ tag_name: 'v1.1.0', html_url: RELEASE_URL, body: '## Novo\n- **a**' });
    const res = await createUpdater(deps).check({ manual: true });
    expect(res).toMatchObject({ mode: 'portable', status: 'available', latestVersion: '1.1.0' });
    expect(states[0]).toMatchObject({ phase: 'portable-available', mode: 'portable', version: '1.1.0', notes: '## Novo\n- **a**' });
    expect(JSON.stringify(states)).not.toMatch(/github\.com|https?:/);
    expect(deps.fetchJson).not.toHaveBeenCalled();
  });

  test('"Abrir página": openExternal só com a URL guardada no main; uma url no payload é ignorada', async () => {
    const { deps, shell } = portable();
    deps.fetchLatest.mockResolvedValue({ tag_name: 'v1.1.0', html_url: RELEASE_URL, body: 'x' });
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    const seq = updater.getState().seq;
    const res = updater.respond({ action: 'openDownloadPage', seq, url: 'https://evil.example/' });
    expect(res).toMatchObject({ accepted: true, state: { phase: 'idle' } });
    await flush();
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
    expect(shell.openExternal).toHaveBeenCalledWith(RELEASE_URL);
  });

  test('"Agora não" (dismiss): não abre nada; ações do instalador são recusadas', async () => {
    const { deps, shell } = portable();
    deps.fetchLatest.mockResolvedValue({ tag_name: 'v1.1.0', html_url: RELEASE_URL });
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    for (const action of ['download', 'later', 'restart', 'installOnQuit']) expect(answer(updater, action).accepted).toBe(false);
    expect(answer(updater, 'dismiss').accepted).toBe(true);
    await flush();
    expect(shell.openExternal).not.toHaveBeenCalled();
    expect(updater.getState().phase).toBe('idle');
  });

  test('com o aviso aberto, nova verificação devolve busy', async () => {
    const { deps } = portable();
    deps.fetchLatest.mockResolvedValue({ tag_name: 'v1.1.0', html_url: RELEASE_URL });
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'busy' });
    expect(deps.fetchLatest).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['URL de outro repositório', 'https://github.com/GregoryCardoso/skins-manager-evil/releases/tag/v9'],
    ['URL com @', 'https://github.com@evil.com/GregoryCardoso/skins-manager/releases/x'],
    ['http', 'http://github.com/GregoryCardoso/skins-manager/releases/tag/v9'],
    ['javascript', 'javascript:alert(1)'],
  ])('%s: status error, sem estado e sem openExternal', async (_n, url) => {
    const { deps, shell, states } = portable();
    deps.fetchLatest.mockResolvedValue({ tag_name: 'v9.0.0', html_url: url });
    const res = await createUpdater(deps).check({ manual: true });
    await flush();
    expect(res.status).toBe('error');
    expect(states).toEqual([]);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  test('igual, mais antiga, rascunho e pré-release: nunca oferece', async () => {
    for (const json of [
      { tag_name: 'v1.0.0', html_url: RELEASE_URL },
      { tag_name: 'v0.5.0', html_url: RELEASE_URL },
    ]) {
      const { deps, states } = portable();
      deps.fetchLatest.mockResolvedValue(json);
      expect((await createUpdater(deps).check({ manual: true })).status).toBe('up-to-date');
      expect(states).toEqual([]);
    }
    for (const json of [
      { tag_name: 'v2.0.0', html_url: RELEASE_URL, draft: true },
      { tag_name: 'v2.0.0', html_url: RELEASE_URL, prerelease: true },
      null,
      {},
    ]) {
      const { deps, states } = portable();
      deps.fetchLatest.mockResolvedValue(json);
      expect((await createUpdater(deps).check({ manual: true })).status).toBe('error');
      expect(states).toEqual([]);
    }
  });

  test('falha de rede: manual vira error; automática só registra', async () => {
    const { deps, states } = portable();
    deps.fetchLatest.mockRejectedValue(new Error('HTTP 403'));
    const updater = createUpdater(deps);
    expect((await updater.check({ manual: true })).status).toBe('error');
    expect(await updater.check({ manual: false })).toMatchObject({ status: 'error' });
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('HTTP 403'));
    expect(states).toEqual([]);
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

  test('fetchJson usa a URL recebida (notas por tag) com os mesmos limites', async () => {
    const cap = stubGet(200, (res) => {
      res.emit('data', Buffer.from('{"tag_name":"v1.2.3","body":"x"}'));
      res.emit('end');
    });
    await expect(fetchJson('https://api.github.com/repos/GregoryCardoso/skins-manager/releases/tags/v1.2.3')).resolves.toMatchObject({
      body: 'x',
    });
    expect(cap.url).toBe('https://api.github.com/repos/GregoryCardoso/skins-manager/releases/tags/v1.2.3');
    expect(cap.options.timeout).toBe(10000);
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
