'use strict';

const { EventEmitter } = require('events');
const { createBackendSupervisor } = require('../src/backendSupervisor');

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
  const logs = [];
  let clock = 1_000_000;
  const supervisor = createBackendSupervisor({
    fork: (entry, args, forkOptions) => {
      const child = fakeChild();
      child.forkOptions = forkOptions;
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
    logger: { info() {}, error() {}, backend: (text) => logs.push(text) },
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
  return { supervisor, children, events, timers, logs, fire, advance: (ms) => { clock += ms; } };
}

function readyOne(options) {
  const ctx = setup(options);
  ctx.supervisor.start({ port: 3001 });
  ctx.children[0].emit('message', { type: 'ready', port: 3001, version: '1.0.0' });
  return ctx;
}

describe('backendSupervisor: casos adicionais', () => {
  test('fatal depois de um restart (ex.: PORT_IN_USE) não entra em loop', () => {
    const { supervisor, children, events, fire, advance } = readyOne();
    children[0].emit('exit', 1);
    advance(1000);
    fire(1000);
    children[1].emit('message', { type: 'fatal', code: 'PORT_IN_USE', message: 'x' });
    children[1].emit('exit', 1);
    expect(events[events.length - 1]).toEqual(['startupFailure', { code: 'PORT_IN_USE', message: 'x' }]);
    expect(supervisor.getState()).toBe('failed');
    expect(children).toHaveLength(2);
  });

  test('stop durante a espera do reinício cancela o reinício', async () => {
    const { supervisor, children, timers } = readyOne();
    children[0].emit('exit', 1);
    expect(supervisor.getState()).toBe('restarting');
    await supervisor.stop();
    expect(supervisor.getState()).toBe('idle');
    expect(timers.find((t) => t.ms === 1000).cleared).toBe(true);
    expect(children).toHaveLength(1);
  });

  test('saída causada por stop() não conta como queda', async () => {
    const { supervisor, children, events } = readyOne();
    await supervisor.stop();
    expect(events.map((e) => e[0])).toEqual(['ready']);
    expect(supervisor.getState()).toBe('idle');
    expect(children).toHaveLength(1);
  });

  test('quedas espaçadas além de 5 minutos nunca desistem', () => {
    const { supervisor, children, events, fire, advance } = readyOne();
    for (let i = 0; i < 6; i += 1) {
      children[i].emit('exit', 1);
      advance(6 * 60 * 1000);
      fire(1000);
      children[i + 1].emit('message', { type: 'ready', port: 3001 });
    }
    expect(events.find((e) => e[0] === 'gaveUp')).toBeUndefined();
    expect(supervisor.getState()).toBe('running');
  });

  test('depois de 3 reinícios e 5 min de calma, a próxima queda recomeça em 1 s', () => {
    const { children, events, fire, advance } = readyOne();
    [1000, 3000, 9000].forEach((d, i) => {
      children[i].emit('exit', 1);
      advance(d);
      fire(d);
      children[i + 1].emit('message', { type: 'ready', port: 3001 });
    });
    advance(5 * 60 * 1000);
    children[3].emit('exit', 1);
    expect(events[events.length - 1]).toEqual(['restarting', { attempt: 1, delayMs: 1000 }]);
  });

  test('mensagens de um processo antigo são ignoradas', () => {
    const { supervisor, children, events, fire, advance } = readyOne();
    children[0].emit('exit', 1);
    advance(1000);
    fire(1000);
    children[0].emit('message', { type: 'ready', port: 9999 });
    expect(supervisor.getState()).toBe('starting');
    expect(events.filter((e) => e[0] === 'ready')).toHaveLength(1);
  });

  test('tratador que lança erro não derruba o supervisor', () => {
    const { supervisor, children } = setup({ handlers: { onReady: () => { throw new Error('boom'); } } });
    supervisor.start({ port: 3001 });
    expect(() => children[0].emit('message', { type: 'ready', port: 3001 })).not.toThrow();
    expect(supervisor.getState()).toBe('running');
  });

  test('mensagem inválida (null, texto) é ignorada', () => {
    const { supervisor, children } = setup();
    supervisor.start({ port: 3001 });
    expect(() => {
      children[0].emit('message', null);
      children[0].emit('message', 'ready');
    }).not.toThrow();
    expect(supervisor.getState()).toBe('starting');
  });

  test('retry fora do estado failed não faz nada', () => {
    const { supervisor, children } = readyOne();
    supervisor.retry();
    expect(children).toHaveLength(1);
  });

  test('baseEnv não é alterado e PORT/DB_PATH/MODE são sobrescritos', () => {
    const baseEnv = { PORT: '1', DB_PATH: 'x', SKINS_MANAGER_MODE: 'browser' };
    const { supervisor, children } = setup({ baseEnv });
    supervisor.start({ port: 3007 });
    expect(children[0].forkOptions.env).toMatchObject({ PORT: '3007', DB_PATH: 'C:\\data\\inventory.sqlite', SKINS_MANAGER_MODE: 'desktop' });
    expect(baseEnv.PORT).toBe('1');
  });

  test('stdout/stderr do backend vão para o log do backend', () => {
    const { children, logs } = setup();
    // setup não inicia; inicia agora
    const ctx = setup();
    ctx.supervisor.start({ port: 3001 });
    ctx.children[0].stdout.emit('data', Buffer.from('linha1\n'));
    ctx.children[0].stderr.emit('data', Buffer.from('erro\n'));
    expect(ctx.logs).toEqual(['linha1\n', 'erro\n']);
    expect(children).toHaveLength(0);
    expect(logs).toEqual([]);
  });

  test('timeout do ready não vaza para a fase running (ready cancela o timer)', () => {
    const { timers } = readyOne();
    expect(timers.find((t) => t.ms === 60000).cleared).toBe(true);
  });
});
