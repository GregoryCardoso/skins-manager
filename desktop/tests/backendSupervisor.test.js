'use strict';

const { EventEmitter } = require('events');
const { createBackendSupervisor } = require('../src/backendSupervisor');

// Processo falso no formato do utilityProcess: eventos `message` e `exit`, postMessage e kill.
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.sent = [];
  child.killed = false;
  child.postMessage = (message) => {
    child.sent.push(message);
    if (message.type === 'shutdown') setImmediate(() => child.emit('exit', 0));
  };
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

function setup(options = {}) {
  const children = [];
  const events = [];
  const timers = [];
  let clock = 1_000_000;
  const supervisor = createBackendSupervisor({
    fork: (entry, args, forkOptions) => {
      const child = fakeChild();
      child.forkOptions = forkOptions;
      child.entry = entry;
      children.push(child);
      return child;
    },
    entry: 'C:\\app\\backend\\server.js',
    dbPath: 'C:\\data\\inventory.sqlite',
    baseEnv: { PATH: 'p' },
    now: () => clock,
    setTimeoutFn: (fn, ms) => {
      const timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: (timer) => {
      if (timer) timer.cleared = true;
    },
    handlers: {
      onReady: (p) => events.push(['ready', p]),
      onRestarting: (p) => events.push(['restarting', p]),
      onStartupFailure: (p) => events.push(['startupFailure', p]),
      onGaveUp: (p) => events.push(['gaveUp', p]),
    },
    ...options,
  });
  const fire = (ms) => {
    const timer = timers.find((t) => !t.cleared && t.ms === ms);
    timer.cleared = true;
    timer.fn();
  };
  return { supervisor, children, events, timers, fire, advance: (ms) => { clock += ms; } };
}

describe('backendSupervisor', () => {
  test('passa DB_PATH, PORT e SKINS_MANAGER_MODE=desktop ao backend', () => {
    const { supervisor, children } = setup();
    supervisor.start({ port: 3004 });
    expect(children[0].entry).toBe('C:\\app\\backend\\server.js');
    expect(children[0].forkOptions.env).toMatchObject({ DB_PATH: 'C:\\data\\inventory.sqlite', PORT: '3004', SKINS_MANAGER_MODE: 'desktop', PATH: 'p' });
    expect(children[0].forkOptions.stdio).toBe('pipe');
  });

  test('ready leva ao estado running e avisa', () => {
    const { supervisor, children, events } = setup();
    supervisor.start({ port: 3001 });
    children[0].emit('message', { type: 'ready', port: 3001, version: '1.0.0' });
    expect(supervisor.getState()).toBe('running');
    expect(events).toEqual([['ready', { port: 3001, version: '1.0.0', restarted: false }]]);
  });

  test('fatal antes do ready: não reinicia e entrega código e mensagem', () => {
    const { supervisor, children, events } = setup();
    supervisor.start({ port: 3001 });
    children[0].emit('message', { type: 'fatal', code: 'DATA_DIR_LOCKED', message: 'já aberto' });
    children[0].emit('exit', 1);
    expect(events).toEqual([['startupFailure', { code: 'DATA_DIR_LOCKED', message: 'já aberto' }]]);
    expect(supervisor.getState()).toBe('failed');
    expect(children).toHaveLength(1);
  });

  test('saída antes do primeiro ready, sem mensagem: falha de inicialização, sem reinício', () => {
    const { supervisor, children, events } = setup();
    supervisor.start({ port: 3001 });
    children[0].emit('exit', 1);
    expect(events[0][0]).toBe('startupFailure');
    expect(events[0][1].code).toBe('BACKEND_EXITED');
    expect(children).toHaveLength(1);
  });

  test('sem ready em 60 s: mata o processo e avisa timeout', () => {
    const { supervisor, children, events, fire } = setup();
    supervisor.start({ port: 3001 });
    fire(60000);
    expect(children[0].killed).toBe(true);
    expect(events).toEqual([['startupFailure', { code: 'START_TIMEOUT', message: '' }]]);
    children[0].emit('exit', null); // saída tardia do processo morto não dispara nada novo
    expect(events).toHaveLength(1);
  });

  test('queda depois do ready: reinicia com 1 s, 3 s, 9 s e desiste na 4a', () => {
    const { supervisor, children, events, fire, advance } = setup();
    supervisor.start({ port: 3001 });
    children[0].emit('message', { type: 'ready', port: 3001 });

    const delays = [1000, 3000, 9000];
    delays.forEach((delay, index) => {
      children[index].emit('exit', 1);
      expect(supervisor.getState()).toBe('restarting');
      expect(events[events.length - 1]).toEqual(['restarting', { attempt: index + 1, delayMs: delay }]);
      advance(delay);
      fire(delay);
      expect(children).toHaveLength(index + 2);
      children[index + 1].emit('message', { type: 'ready', port: 3001 });
      expect(events[events.length - 1][1].restarted).toBe(true);
    });

    children[3].emit('exit', 1);
    expect(events[events.length - 1]).toEqual(['gaveUp', { crashes: 4 }]);
    expect(supervisor.getState()).toBe('failed');
  });

  test('retry depois de falhar zera o contador e sobe de novo', () => {
    const { supervisor, children, fire } = setup();
    supervisor.start({ port: 3001 });
    fire(60000); // falha por timeout
    expect(supervisor.getState()).toBe('failed');
    supervisor.retry();
    expect(children).toHaveLength(2);
    expect(supervisor.getState()).toBe('starting');
  });

  test('stop manda shutdown, espera a saída e não reinicia', async () => {
    const { supervisor, children, events } = setup();
    supervisor.start({ port: 3001 });
    children[0].emit('message', { type: 'ready', port: 3001 });
    await supervisor.stop();
    expect(children[0].sent).toEqual([{ type: 'shutdown' }]);
    expect(supervisor.getState()).toBe('idle');
    expect(events.filter((e) => e[0] !== 'ready')).toEqual([]);
    expect(children).toHaveLength(1);
  });

  test('stop sem resposta em 3 s: mata o processo', async () => {
    const { supervisor, children, fire } = setup();
    supervisor.start({ port: 3001 });
    children[0].emit('message', { type: 'ready', port: 3001 });
    children[0].postMessage = () => {}; // backend travado: não responde ao shutdown
    const stopping = supervisor.stop();
    fire(3000);
    expect(children[0].killed).toBe(true);
    fire(1000); // espera curta pela saída do processo morto (sem evento de saída aqui)
    await stopping;
    expect(supervisor.getState()).toBe('idle');
  });

  test('stop sem processo resolve na hora', async () => {
    const { supervisor } = setup();
    await expect(supervisor.stop()).resolves.toBeUndefined();
  });
});
