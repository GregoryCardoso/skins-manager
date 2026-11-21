'use strict';

// QA da revisão da Etapa 7 (D181): o `restartBackend` injetado pelo main.js (`supervisor.start({ port: appPort })`)
// precisa funcionar de verdade depois de `supervisor.stop()`. Aqui o supervisor é o REAL (com fork falso) e o
// updater também; só o Electron é simulado. Também cobre restartBackend lançando/rejeitando.
const { EventEmitter } = require('events');
const { createBackendSupervisor } = require('../src/backendSupervisor');
const { createUpdater } = require('../src/updater');
const { makeDeps, flush } = require('./helpers/fakeUpdaterDeps');

const AVAILABLE = { isUpdateAvailable: true, updateInfo: { version: '1.1.0', releaseNotes: 'x' } };

function fakeChild({ ignoreShutdown = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.sent = [];
  child.killed = false;
  child.postMessage = (message) => {
    child.sent.push(message);
    if (message.type === 'shutdown' && !ignoreShutdown) setImmediate(() => child.emit('exit', 0));
  };
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

function setupSupervisor({ ignoreShutdown = false } = {}) {
  const children = [];
  const events = [];
  const supervisor = createBackendSupervisor({
    fork: (entry, args, options) => {
      const child = fakeChild({ ignoreShutdown });
      child.options = options;
      children.push(child);
      return child;
    },
    entry: 'C:\\app\\backend\\server.js',
    dbPath: 'C:\\data\\inventory.sqlite',
    baseEnv: {},
    setTimeoutFn: (fn, ms) => setTimeout(fn, ms > 100 ? 20 : ms),
    clearTimeoutFn: (t) => clearTimeout(t),
    stopTimeoutMs: 30,
    handlers: {
      onReady: (p) => events.push(['ready', p]),
      onStartupFailure: (p) => events.push(['startupFailure', p]),
      onGaveUp: (p) => events.push(['gaveUp', p]),
      onRestarting: (p) => events.push(['restarting', p]),
    },
  });
  return { supervisor, children, events };
}

describe('supervisor.start({ port }) depois de stop()', () => {
  test('sobe um processo novo na mesma porta e volta a ficar pronto (restarted=false, sem tratar como queda)', async () => {
    const { supervisor, children, events } = setupSupervisor();
    supervisor.start({ port: 3055 });
    children[0].emit('message', { type: 'ready', port: 3055, version: '1.0.0' });
    expect(supervisor.getState()).toBe('running');

    await supervisor.stop();
    expect(supervisor.getState()).toBe('idle');
    expect(children[0].sent).toEqual([{ type: 'shutdown' }]);

    supervisor.start({ port: supervisor.getPort() }); // o que o restartBackend do main.js faz com appPort
    expect(children).toHaveLength(2);
    expect(children[1].options.env.PORT).toBe('3055');
    expect(children[1].options.env.SKINS_MANAGER_MODE).toBe('desktop');
    expect(supervisor.getState()).toBe('starting');
    children[1].emit('message', { type: 'ready', port: 3055, version: '1.0.0' });
    expect(supervisor.getState()).toBe('running');
    expect(events.filter((e) => e[0] === 'ready')).toHaveLength(2);
    expect(events.filter((e) => e[0] === 'ready')[1][1]).toMatchObject({ port: 3055, restarted: false });
    expect(events.some((e) => e[0] === 'restarting' || e[0] === 'gaveUp' || e[0] === 'startupFailure')).toBe(false);
  });

  test('o processo antigo, morto à força no stop, não derruba o novo ao emitir "exit" atrasado', async () => {
    const { supervisor, children, events } = setupSupervisor({ ignoreShutdown: true });
    supervisor.start({ port: 3055 });
    children[0].emit('message', { type: 'ready', port: 3055 });
    await supervisor.stop(); // não respondeu: matou depois de stopTimeoutMs
    expect(children[0].killed).toBe(true);

    supervisor.start({ port: 3055 });
    children[1].emit('message', { type: 'ready', port: 3055 });
    children[0].emit('exit', 1); // saída atrasada do antigo
    expect(supervisor.getState()).toBe('running');
    expect(events.some((e) => e[0] === 'restarting' || e[0] === 'startupFailure')).toBe(false);
  });

  test('kill forçado: stop() só libera quando o processo antigo sai (ou depois da espera curta)', async () => {
    const { supervisor, children } = setupSupervisor({ ignoreShutdown: true });
    supervisor.start({ port: 3055 });
    children[0].emit('message', { type: 'ready', port: 3055 });
    let resolved = false;
    const stopping = supervisor.stop().then(() => { resolved = true; });
    await new Promise((r) => setTimeout(r, 40)); // passou do stopTimeoutMs (30): já matou
    expect(children[0].killed).toBe(true);
    expect(resolved).toBe(false); // ainda esperando a saída
    children[0].emit('exit', 1);
    await stopping;
    expect(resolved).toBe(true);
    expect(supervisor.getState()).toBe('idle');
  });

  test('kill forçado sem evento de saída: stop() libera depois da espera curta', async () => {
    const { supervisor, children } = setupSupervisor({ ignoreShutdown: true });
    supervisor.start({ port: 3055 });
    children[0].emit('message', { type: 'ready', port: 3055 });
    await supervisor.stop();
    expect(children[0].killed).toBe(true);
    expect(supervisor.getState()).toBe('idle');
  });

  test('stop() de novo depois do reinício encerra o novo processo normalmente', async () => {
    const { supervisor, children } = setupSupervisor();
    supervisor.start({ port: 3055 });
    children[0].emit('message', { type: 'ready', port: 3055 });
    await supervisor.stop();
    supervisor.start({ port: 3055 });
    children[1].emit('message', { type: 'ready', port: 3055 });
    await supervisor.stop();
    expect(children[1].sent).toEqual([{ type: 'shutdown' }]);
    expect(supervisor.getState()).toBe('idle');
  });

  test('o novo backend que recusa iniciar (ex.: trava ainda do antigo) cai em onStartupFailure, sem laço de reinício', async () => {
    const { supervisor, children, events } = setupSupervisor();
    supervisor.start({ port: 3055 });
    children[0].emit('message', { type: 'ready', port: 3055 });
    await supervisor.stop();
    supervisor.start({ port: 3055 });
    children[1].emit('message', { type: 'fatal', code: 'DATA_DIR_LOCKED', message: 'travada' });
    children[1].emit('exit', 1);
    expect(events.filter((e) => e[0] === 'startupFailure')).toEqual([['startupFailure', { code: 'DATA_DIR_LOCKED', message: 'travada' }]]);
    expect(children).toHaveLength(2);
  });
});

describe('updater + supervisor real: quitAndInstall falhando', () => {
  async function runFailingRestart({ restartBackend }) {
    const { deps, autoUpdater, dialogs } = makeDeps({ deps: { restartBackend } });
    autoUpdater.quitAndInstall.mockImplementation(() => {
      throw new Error('instalador indisponível');
    });
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    dialogs.showUpdateAvailable.mockResolvedValue('download');
    dialogs.showUpdateReady.mockResolvedValue('restart');
    await createUpdater(deps).check({ manual: true });
    await flush();
    return { deps, dialogs };
  }

  test('fluxo completo: stop real -> quitAndInstall falha -> start real -> backend pronto de novo -> erro mostrado', async () => {
    const { supervisor, children, events } = setupSupervisor();
    supervisor.start({ port: 3060 });
    children[0].emit('message', { type: 'ready', port: 3060 });
    const appPort = 3060;
    const { deps, autoUpdater, dialogs } = makeDeps({
      deps: {
        stopBackend: async () => {
          await supervisor.stop();
        },
        restartBackend: async () => {
          supervisor.start({ port: appPort });
        },
      },
    });
    autoUpdater.quitAndInstall.mockImplementation(() => {
      throw new Error('falhou');
    });
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    dialogs.showUpdateAvailable.mockResolvedValue('download');
    dialogs.showUpdateReady.mockResolvedValue('restart');
    await createUpdater(deps).check({ manual: true });
    await flush();
    expect(children).toHaveLength(2);
    expect(supervisor.getState()).toBe('starting');
    children[1].emit('message', { type: 'ready', port: 3060 });
    expect(supervisor.getState()).toBe('running');
    expect(dialogs.showUpdateError).toHaveBeenCalledWith(expect.objectContaining({ reason: 'falhou' }));
    expect(events.filter((e) => e[0] === 'ready')).toHaveLength(2);
  });

  test('restartBackend lançando de forma síncrona: o erro é registrado e o diálogo de erro ainda aparece', async () => {
    const restartBackend = jest.fn(() => {
      throw new Error('sync boom');
    });
    const { deps, dialogs } = await runFailingRestart({ restartBackend });
    expect(restartBackend).toHaveBeenCalledTimes(1);
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('Falha ao religar o backend: sync boom'));
    expect(dialogs.showUpdateError).toHaveBeenCalledTimes(1);
    expect(dialogs.showUpdateError).toHaveBeenCalledWith(expect.objectContaining({ reason: 'instalador indisponível' }));
  });

  test('restartBackend rejeitando: idem (o motivo mostrado é o do quitAndInstall, não o do religamento)', async () => {
    const restartBackend = jest.fn(async () => {
      throw new Error('async boom');
    });
    const { deps, dialogs } = await runFailingRestart({ restartBackend });
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('Falha ao religar o backend: async boom'));
    expect(dialogs.showUpdateError).toHaveBeenCalledWith(expect.objectContaining({ reason: 'instalador indisponível' }));
  });

  test('rejeição sem Error (string/undefined) não quebra o fluxo', async () => {
    for (const value of ['texto solto', undefined]) {
      const restartBackend = jest.fn(async () => {
        throw value;
      });
      const { dialogs } = await runFailingRestart({ restartBackend });
      expect(dialogs.showUpdateError).toHaveBeenCalledTimes(1);
    }
  });

  test('depois do erro o updater continua utilizável: nova verificação manual não fica "busy"', async () => {
    const { deps, autoUpdater, dialogs } = makeDeps({ deps: { restartBackend: async () => {} } });
    autoUpdater.quitAndInstall.mockImplementation(() => {
      throw new Error('x');
    });
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    dialogs.showUpdateAvailable.mockResolvedValue('download');
    dialogs.showUpdateReady.mockResolvedValue('restart');
    const updater = createUpdater(deps);
    await updater.check({ manual: true });
    await flush();
    const again = await updater.check({ manual: true });
    expect(again.status).toBe('ready'); // já baixada; oferece o reinício de novo, não 'busy'
  });

  test('stopBackend lançando: quitAndInstall NÃO é chamado e o erro fica no log', async () => {
    const { deps, autoUpdater, dialogs } = makeDeps({
      deps: {
        stopBackend: async () => {
          throw new Error('stop falhou');
        },
      },
    });
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    dialogs.showUpdateAvailable.mockResolvedValue('download');
    dialogs.showUpdateReady.mockResolvedValue('restart');
    await createUpdater(deps).check({ manual: true });
    await flush();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('stop falhou'));
  });
});
