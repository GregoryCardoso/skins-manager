'use strict';

// QA da v1.0.2: lacunas além de updater.test.js (matriz fase x ação pelo updater real, seq repetido,
// repetição depois de falhas, limite de progresso sob carga e notas).
const { createUpdater } = require('../src/updater');
const { ACTIONS, PHASES } = require('../src/lib/updateState');
const { makeDeps, flush, answer, downloadToReady } = require('./helpers/fakeUpdaterDeps');

const RELEASE_URL = 'https://github.com/GregoryCardoso/skins-manager/releases/tag/v1.1.0';
const AVAILABLE = { isUpdateAvailable: true, updateInfo: { version: '1.1.0', releaseNotes: '<p>Novidades</p>' } };
const PORTABLE_ENV = { PORTABLE_EXECUTABLE_FILE: 'C:\\SkinsManager-Portable.exe' };

// Ações aceitas por fase, conforme a tabela de D188.
const TABLE = {
  idle: [],
  available: ['download', 'later'],
  downloading: [],
  ready: ['restart', 'installOnQuit'],
  installing: [],
  error: ['dismiss'],
  'portable-available': ['openDownloadPage', 'dismiss'],
};

// Leva um updater novo até a fase pedida e devolve tudo o que o teste precisa para observar efeitos.
async function setup(phase) {
  const restartBackend = jest.fn(async () => {});
  let releaseStop;
  const overrides = { restartBackend };
  if (phase === 'portable-available') overrides.env = PORTABLE_ENV;
  if (phase === 'installing') {
    overrides.stopBackend = jest.fn(() => new Promise((resolve) => (releaseStop = resolve)));
  }
  const ctx = makeDeps({ deps: overrides });
  const { deps, autoUpdater } = ctx;
  autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
  deps.fetchLatest.mockResolvedValue({ tag_name: 'v1.1.0', html_url: RELEASE_URL, body: 'x' });
  const updater = createUpdater(deps);
  let finishDownload;
  switch (phase) {
    case 'idle':
      break;
    case 'available':
    case 'portable-available':
      await updater.check({ manual: true });
      break;
    case 'downloading':
      autoUpdater.downloadUpdate.mockImplementation(() => new Promise((resolve) => (finishDownload = resolve)));
      await updater.check({ manual: true });
      answer(updater, 'download');
      await flush();
      break;
    case 'ready':
      await downloadToReady(updater);
      break;
    case 'installing':
      await downloadToReady(updater);
      answer(updater, 'restart');
      await flush();
      break;
    case 'error':
      autoUpdater.downloadUpdate.mockRejectedValue(new Error('rede caiu'));
      await updater.check({ manual: true });
      answer(updater, 'download');
      await flush();
      break;
    default:
      throw new Error(`fase desconhecida ${phase}`);
  }
  expect(updater.getState().phase).toBe(phase);
  return { ...ctx, updater, releaseStop: () => releaseStop && releaseStop(), finishDownload: () => finishDownload && finishDownload([]) };
}

describe('matriz fase x ação pelo updater real (D188)', () => {
  const cases = [];
  for (const phase of PHASES) for (const action of ACTIONS) cases.push([phase, action, TABLE[phase].includes(action)]);

  test('a tabela do teste cobre todas as fases', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...PHASES].sort());
  });

  test.each(cases)('fase %s, ação %s: aceita = %s', async (phase, action, allowed) => {
    const { updater, autoUpdater, shell, calls, states } = await setup(phase);
    const before = updater.getState();
    const statesBefore = states.length;
    const downloadsBefore = autoUpdater.downloadUpdate.mock.calls.length;
    const quitsBefore = autoUpdater.quitAndInstall.mock.calls.length;
    const res = updater.respond({ action, seq: before.seq });
    await flush();
    expect(res.accepted).toBe(allowed);
    if (!allowed) {
      // recusada: estado intacto (mesmo objeto), nada publicado e nenhum efeito colateral
      expect(updater.getState()).toBe(before);
      expect(res.state).toBe(before);
      expect(states).toHaveLength(statesBefore);
      expect(autoUpdater.downloadUpdate.mock.calls.length).toBe(downloadsBefore);
      expect(autoUpdater.quitAndInstall.mock.calls.length).toBe(quitsBefore);
      expect(shell.openExternal).not.toHaveBeenCalled();
      expect(calls.filter((c) => c[0] === 'quitAndInstall')).toHaveLength(quitsBefore);
    } else {
      expect(updater.getState().seq).toBeGreaterThan(before.seq);
    }
  });

  test('seq velho, futuro e repetido nunca são aceitos, em nenhuma fase com ação válida', async () => {
    for (const phase of ['available', 'ready', 'error', 'portable-available']) {
      const { updater } = await setup(phase);
      const { seq } = updater.getState();
      const action = TABLE[phase][0];
      expect(updater.respond({ action, seq: seq - 1 }).accepted).toBe(false);
      expect(updater.respond({ action, seq: seq + 1 }).accepted).toBe(false);
      expect(updater.respond({ action, seq: 0 }).accepted === (seq === 0)).toBe(true);
      expect(updater.getState().seq).toBe(seq);
      expect(updater.respond({ action, seq }).accepted).toBe(true);
      // o mesmo clique de novo (seq repetido): ignorado
      expect(updater.respond({ action, seq }).accepted).toBe(false);
    }
  });

  test('duplo clique em "Baixar" baixa uma vez só', async () => {
    const { updater, autoUpdater } = await setup('available');
    const { seq } = updater.getState();
    updater.respond({ action: 'download', seq });
    updater.respond({ action: 'download', seq });
    await flush();
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  test('duplo clique em "Reiniciar agora" instala uma vez só', async () => {
    const { updater, autoUpdater } = await setup('ready');
    const { seq } = updater.getState();
    updater.respond({ action: 'restart', seq });
    updater.respond({ action: 'restart', seq });
    await flush();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test('payloads inválidos nunca mudam nada (inclusive prototype e getters)', async () => {
    const { updater, states } = await setup('available');
    const before = updater.getState();
    const evil = { seq: before.seq };
    Object.defineProperty(evil, 'action', { get: () => 'download', enumerable: true });
    for (const payload of [undefined, null, 5, 'download', [], {}, { action: 'download' }, { seq: before.seq }, { action: ['download'], seq: before.seq }, { action: 'toString', seq: before.seq }, { action: '__proto__', seq: before.seq }, { action: 'constructor', seq: before.seq }, { action: 'download', seq: String(before.seq) }, { action: 'download', seq: NaN }, { action: 'download', seq: Number.MAX_SAFE_INTEGER + 2 }]) {
      expect(updater.respond(payload).accepted).toBe(false);
    }
    expect(updater.getState()).toBe(before);
    // um getter com a ação válida ainda é só a ação lida uma vez; o resultado é o mesmo de um objeto comum
    expect(typeof updater.respond(evil).accepted).toBe('boolean');
    expect(states.length).toBeGreaterThanOrEqual(1);
  });
});

describe('fluxos com falha e nova tentativa', () => {
  test('erro de download: "Fechar" (dismiss), nova verificação e novo download completam', async () => {
    const { updater, autoUpdater } = await setup('error');
    expect(updater.getState().error).toMatchObject({ kind: 'download', detail: 'rede caiu' });
    expect(answer(updater, 'dismiss').accepted).toBe(true);
    expect(updater.getState()).toMatchObject({ phase: 'idle', error: null, version: null });
    autoUpdater.downloadUpdate.mockResolvedValue([]);
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'available' });
    answer(updater, 'download');
    await flush();
    expect(updater.getState()).toMatchObject({ phase: 'ready', version: '1.1.0' });
  });

  test('erro de instalação: dismiss, verificação manual reabre ready e a segunda tentativa instala', async () => {
    const restartBackend = jest.fn(async () => {});
    const { deps, autoUpdater, calls } = makeDeps({ deps: { restartBackend } });
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    let attempt = 0;
    autoUpdater.quitAndInstall.mockImplementation((...args) => {
      attempt += 1;
      if (attempt === 1) throw new Error('falhou na primeira');
      calls.push(['quitAndInstall', ...args]);
    });
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    answer(updater, 'restart');
    await flush();
    expect(updater.getState()).toMatchObject({ phase: 'error', error: { kind: 'install', detail: 'falhou na primeira' } });
    expect(restartBackend).toHaveBeenCalledTimes(1);
    expect(answer(updater, 'dismiss').accepted).toBe(true);
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'ready' });
    expect(updater.getState().phase).toBe('ready');
    answer(updater, 'restart');
    await flush();
    expect(calls.filter((c) => c[0] === 'quitAndInstall')).toEqual([['quitAndInstall', true, true]]);
  });

  test('stopBackend lançando: vai a error/install e a próxima tentativa funciona', async () => {
    let fail = true;
    const stopBackend = jest.fn(async () => {
      if (fail) throw new Error('backend travado');
    });
    const { deps, autoUpdater } = makeDeps({ deps: { stopBackend } });
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    answer(updater, 'restart');
    await flush();
    expect(updater.getState()).toMatchObject({ phase: 'error', error: { kind: 'install' } });
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    fail = false;
    answer(updater, 'dismiss');
    await updater.check({ manual: true });
    answer(updater, 'restart');
    await flush();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test('detalhe de erro enorme ou não texto é cortado em 500 caracteres no estado publicado', async () => {
    const { deps, autoUpdater, states } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    autoUpdater.downloadUpdate.mockRejectedValue(new Error('x'.repeat(5000)));
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    answer(updater, 'download');
    await flush();
    expect(updater.getState().error.detail).toHaveLength(500);
    expect(states[states.length - 1].error.detail).toHaveLength(500);
  });

  test('download rejeitado com valor que não é Error também vira error/download', async () => {
    const { deps, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    autoUpdater.downloadUpdate.mockRejectedValue('texto solto');
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    answer(updater, 'download');
    await flush();
    expect(updater.getState()).toMatchObject({ phase: 'error', error: { kind: 'download', detail: 'texto solto' } });
  });
});

describe('"Instalar ao fechar" e fechamento do app (V102-Q2)', () => {
  test('installOnQuit uma vez: o before-quit instala uma única vez, mesmo chamado de novo', async () => {
    const { deps, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    answer(updater, 'installOnQuit');
    expect(updater.installPendingOnQuit()).toBe(true);
    expect(updater.installPendingOnQuit()).toBe(false);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, false);
  });

  test('installOnQuit, depois reabrir pelo card Sobre e "Reiniciar agora": instala só pelo reinício', async () => {
    const { deps, autoUpdater, calls } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    answer(updater, 'installOnQuit');
    await updater.check({ manual: true });
    expect(updater.getState().phase).toBe('ready');
    answer(updater, 'restart');
    await flush();
    expect(updater.installPendingOnQuit()).toBe(false);
    expect(calls.filter((c) => c[0] === 'quitAndInstall')).toEqual([['quitAndInstall', true, true]]);
  });

  test('esconder o modal em ready (sem IPC) e fechar o app: nada é instalado, e a verificação manual reabre', async () => {
    const { deps, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    const seq = updater.getState().seq;
    expect(updater.installPendingOnQuit()).toBe(false);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    await updater.check({ manual: true });
    expect(updater.getState().seq).toBe(seq + 1);
    expect(updater.getState().phase).toBe('ready');
  });

  test('"Agora não" depois de baixar não existe: later é recusado em ready', async () => {
    const { updater, autoUpdater } = await setup('ready');
    expect(answer(updater, 'later').accepted).toBe(false);
    expect(answer(updater, 'dismiss').accepted).toBe(false);
    expect(updater.installPendingOnQuit()).toBe(false);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  test('"Agora não" em available nunca baixa, nem depois de várias verificações automáticas', async () => {
    const { updater, autoUpdater } = await setup('available');
    answer(updater, 'later');
    await updater.check({ manual: false });
    answer(updater, 'later');
    await flush();
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });
});

describe('progresso limitado (1 por ponto percentual e 4 por segundo)', () => {
  test('muitos eventos pequenos: no máximo 4 por segundo e nunca o mesmo percentual duas vezes', async () => {
    const { updater, autoUpdater, states, clock, win } = await setup('downloading');
    const published = () => states.filter((s) => s.phase === 'downloading' && s.percent !== null).map((s) => s.percent);
    // 10 s de download a 100 eventos por segundo, 0,1 ponto por evento: 100 pontos em 1000 eventos
    for (let i = 1; i <= 1000; i += 1) {
      clock.now += 10;
      autoUpdater.emit('download-progress', { percent: Math.min(100, i / 10) });
    }
    const percents = published();
    expect(new Set(percents).size).toBe(percents.length);
    expect(percents.length).toBeLessThanOrEqual(1 + Math.ceil(10 * 4));
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
    // a barra de tarefas continua recebendo todos
    expect(win.setProgressBar).toHaveBeenCalledTimes(1000);
    expect(updater.getState().percent).toBeLessThanOrEqual(100);
  });

  test('valores absurdos (NaN, negativo, acima de 100, texto) ficam entre 0 e 100 e nunca quebram', async () => {
    const { autoUpdater, clock, win, updater } = await setup('downloading');
    for (const percent of [NaN, -50, 250, undefined, null, Infinity]) {
      clock.now += 1000;
      expect(() => autoUpdater.emit('download-progress', { percent })).not.toThrow();
    }
    expect(updater.getState().percent).toBeGreaterThanOrEqual(0);
    expect(updater.getState().percent).toBeLessThanOrEqual(100);
    for (const [value] of win.setProgressBar.mock.calls) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  test('evento de progresso depois de pronto não muda o estado', async () => {
    const { updater, autoUpdater, clock } = await setup('ready');
    const before = updater.getState();
    clock.now += 5000;
    autoUpdater.emit('download-progress', { percent: 70 });
    expect(updater.getState()).toBe(before);
  });

  test('o contador do limite reinicia a cada download novo', async () => {
    const { deps, autoUpdater, states, clock } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    autoUpdater.downloadUpdate.mockRejectedValueOnce(new Error('cai'));
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    answer(updater, 'download');
    await flush();
    answer(updater, 'dismiss');
    let finish;
    autoUpdater.downloadUpdate.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await updater.check({ manual: true });
    answer(updater, 'download');
    await flush();
    clock.now += 1;
    autoUpdater.emit('download-progress', { percent: 5 });
    expect(states[states.length - 1]).toMatchObject({ phase: 'downloading', percent: 5 });
    finish([]);
    await flush();
  });
});

describe('notas: versão validada antes da URL e limite de 20 000', () => {
  const run = async (version, json) => {
    const { deps, autoUpdater } = makeDeps();
    deps.fetchJson.mockResolvedValue(json);
    autoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version, releaseNotes: '<p>Do feed</p>' },
    });
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    return { deps, updater };
  };

  test.each([
    '1.1.0/../../../user',
    '1.1.0?x=1',
    '1.1.0#frag',
    '../1.1.0',
    '1.1',
    'latest',
    '',
    '1.1.0 ; rm',
    '1.1.0%2F..',
    'v1.1.0/x',
  ])('versão %j: nenhuma busca na API e notas do feed', async (version) => {
    const { deps, updater } = await run(version, { tag_name: `v${version}`, body: 'NÃO' });
    expect(deps.fetchJson).not.toHaveBeenCalled();
    if (updater.getState().phase === 'available') expect(updater.getState().notes).toBe('Do feed');
  });

  test('versão com espaço ou quebra de linha nas pontas é aparada e monta a mesma URL segura', async () => {
    const { deps } = await run(' 1.1.0\n', { tag_name: 'v1.1.0', body: 'ok' });
    expect(deps.fetchJson.mock.calls).toEqual([['https://api.github.com/repos/GregoryCardoso/skins-manager/releases/tags/v1.1.0']]);
  });

  test('versão com pré-release e build válida monta a URL codificada (e a release de pré-release é recusada)', async () => {
    const { deps, updater } = await run('1.2.0-beta.1', { tag_name: 'v1.2.0-beta.1', body: 'NÃO', prerelease: true });
    expect(deps.fetchJson).toHaveBeenCalledTimes(1);
    expect(deps.fetchJson.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/GregoryCardoso/skins-manager/releases/tags/v1.2.0-beta.1',
    );
    expect(updater.getState().notes).toBe('Do feed');
  });

  test('corpo exatamente no limite não é cortado; um caractere a mais é cortado em fim de linha com reticências', async () => {
    const exact = `${'a'.repeat(19999)}b`;
    expect((await run('1.1.0', { tag_name: 'v1.1.0', body: exact })).updater.getState().notes).toBe(exact);
    const over = `${'linha\n'.repeat(5000)}fim`;
    const notes = (await run('1.1.0', { tag_name: 'v1.1.0', body: over })).updater.getState().notes;
    expect(notes.length).toBeLessThanOrEqual(20001);
    expect(notes.endsWith('…')).toBe(true);
    expect(notes).not.toContain('fim');
  });

  test('corpo gigante sem quebra de linha também respeita o limite', async () => {
    const notes = (await run('1.1.0', { tag_name: 'v1.1.0', body: 'x'.repeat(300000) })).updater.getState().notes;
    expect(notes.length).toBeLessThanOrEqual(20001);
  });

  test('o estado enviado ao renderer não leva o JSON bruto da API nem URLs', async () => {
    const { updater } = await run('1.1.0', {
      tag_name: 'v1.1.0',
      body: 'ok',
      html_url: 'https://github.com/x',
      assets: [{ browser_download_url: 'https://evil.example/a.exe' }],
    });
    expect(Object.keys(updater.getState()).sort()).toEqual(
      ['currentVersion', 'error', 'mode', 'notes', 'percent', 'phase', 'seq', 'version'].sort(),
    );
    expect(JSON.stringify(updater.getState())).not.toMatch(/evil|html_url|https:\/\//);
  });
});

describe('portátil: a URL só existe no main', () => {
  const portable = () => makeDeps({ deps: { env: PORTABLE_ENV } });

  test('dois cliques em "Abrir página" com o mesmo seq abrem uma vez só', async () => {
    const { deps, shell } = portable();
    deps.fetchLatest.mockResolvedValue({ tag_name: 'v1.1.0', html_url: RELEASE_URL, body: 'x' });
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    const seq = updater.getState().seq;
    updater.respond({ action: 'openDownloadPage', seq });
    updater.respond({ action: 'openDownloadPage', seq });
    await flush();
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
  });

  test('payload com url, href ou target nunca altera o destino', async () => {
    const { deps, shell } = portable();
    deps.fetchLatest.mockResolvedValue({ tag_name: 'v1.1.0', html_url: RELEASE_URL, body: 'x' });
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    updater.respond({ action: 'openDownloadPage', seq: updater.getState().seq, url: 'https://evil.example', href: 'file:///c', target: 'x' });
    await flush();
    expect(shell.openExternal.mock.calls).toEqual([[RELEASE_URL]]);
  });

  test('falha do shell.openExternal não derruba nem deixa o modal preso', async () => {
    const { deps, shell } = portable();
    shell.openExternal.mockRejectedValue(new Error('sem navegador'));
    deps.fetchLatest.mockResolvedValue({ tag_name: 'v1.1.0', html_url: RELEASE_URL, body: 'x' });
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    answer(updater, 'openDownloadPage');
    await flush();
    expect(updater.getState().phase).toBe('idle');
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('sem navegador'));
  });

  test('depois de dispensar, a próxima verificação volta a oferecer', async () => {
    const { deps } = portable();
    deps.fetchLatest.mockResolvedValue({ tag_name: 'v1.1.0', html_url: RELEASE_URL, body: 'x' });
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    answer(updater, 'dismiss');
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'available' });
    expect(updater.getState().phase).toBe('portable-available');
  });
});

describe('regressões do fluxo antigo (D181)', () => {
  test('verificação automática com erro: silenciosa (nenhum estado), manual: status error', async () => {
    const { deps, autoUpdater, states } = makeDeps();
    autoUpdater.checkForUpdates.mockRejectedValue(new Error('offline'));
    const updater = createUpdater(deps);
    expect(await updater.check({ manual: false })).toMatchObject({ status: 'error' });
    expect(states).toEqual([]);
    expect(updater.getState().phase).toBe('idle');
    expect(await updater.check({ manual: true })).toMatchObject({ status: 'error' });
    expect(states).toEqual([]);
  });

  test('nenhum diálogo é aberto: o updater nem aceita mais dialogs/getParent/getLanguage', () => {
    const source = require('fs').readFileSync(require.resolve('../src/updater'), 'utf8');
    expect(source).not.toMatch(/dialogs?\.|showMessageBox|getParent|getLanguage/);
  });

  test('timer automático: 10 s, uma vez, também no portátil, e nunca em dev', () => {
    const a = makeDeps();
    createUpdater(a.deps).scheduleAutoCheck();
    expect(a.deps.setTimeoutFn).toHaveBeenCalledTimes(1);
    expect(a.deps.setTimeoutFn.mock.calls[0][1]).toBe(10000);
    const b = makeDeps({ deps: { env: PORTABLE_ENV } });
    createUpdater(b.deps).scheduleAutoCheck();
    expect(b.deps.setTimeoutFn).toHaveBeenCalledTimes(1);
    const c = makeDeps({ app: { isPackaged: false } });
    createUpdater(c.deps).scheduleAutoCheck();
    expect(c.deps.setTimeoutFn).not.toHaveBeenCalled();
  });

  test('publishState lançando durante o fluxo completo não impede nenhuma fase', async () => {
    const { deps, autoUpdater } = makeDeps();
    deps.publishState.mockImplementation(() => {
      throw new Error('janela destruída');
    });
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    expect(updater.getState().phase).toBe('ready');
    answer(updater, 'restart');
    await flush();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  test('em modo dev, respond e getState existem e nenhuma ação é aceita', () => {
    const { deps } = makeDeps({ app: { isPackaged: false } });
    const updater = createUpdater(deps);
    for (const action of ACTIONS) expect(answer(updater, action).accepted).toBe(false);
    expect(updater.getState().phase).toBe('idle');
  });
});
