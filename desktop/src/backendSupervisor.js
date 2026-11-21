'use strict';

// Supervisor do backend (D177, D178): sobe o servidor num processo separado (utilityProcess), espera a
// mensagem `ready`, reinicia quedas inesperadas pela política de reinício e nunca reinicia erro de inicialização.
// Tudo que depende do Electron entra por injeção (`fork`), então a lógica é testável sem janela.
const path = require('path');
const restartPolicy = require('./lib/restartPolicy');

const READY_TIMEOUT_MS = 60 * 1000;
const STOP_TIMEOUT_MS = 3000;

// handlers: onReady({ port, version, restarted }), onRestarting({ attempt, delayMs }),
//           onStartupFailure({ code, message }), onGaveUp({ crashes }).
function createBackendSupervisor({
  fork,
  entry,
  cwd,
  dbPath,
  logger = { info() {}, error() {}, backend() {} },
  handlers = {},
  now = () => Date.now(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  readyTimeoutMs = READY_TIMEOUT_MS,
  stopTimeoutMs = STOP_TIMEOUT_MS,
  baseEnv = process.env,
}) {
  let state = 'idle'; // idle | starting | running | restarting | failed | stopping
  let child = null;
  let port = null;
  let everReady = false;
  let fatalMessage = null;
  let crashTimes = [];
  let readyTimer = null;
  let restartTimer = null;
  let stopWaiters = [];

  const call = (name, payload) => {
    try {
      if (typeof handlers[name] === 'function') handlers[name](payload);
    } catch (err) {
      logger.error(`Erro no tratador ${name}: ${err && err.message ? err.message : err}`);
    }
  };

  function spawn() {
    fatalMessage = null;
    state = 'starting';
    const env = {
      ...baseEnv,
      DB_PATH: dbPath,
      PORT: String(port),
      SKINS_MANAGER_MODE: 'desktop',
    };
    logger.info(`Iniciando o backend na porta ${port}.`);
    const current = fork(entry, [], { cwd: cwd || path.dirname(entry), env, stdio: 'pipe', serviceName: 'Skins Manager Backend' });
    child = current;

    const pipe = (stream) => {
      if (stream && typeof stream.on === 'function') stream.on('data', (chunk) => logger.backend(chunk.toString()));
    };
    pipe(current.stdout);
    pipe(current.stderr);

    current.on('message', (message) => {
      if (current !== child || !message || typeof message !== 'object') return;
      if (message.type === 'ready') {
        clearTimeoutFn(readyTimer);
        const restarted = everReady;
        everReady = true;
        state = 'running';
        logger.info(`Backend pronto na porta ${message.port || port}.`);
        call('onReady', { port: message.port || port, version: message.version, restarted });
      } else if (message.type === 'fatal') {
        fatalMessage = { code: message.code || 'STARTUP_FAILED', message: String(message.message || '') };
        logger.error(`Backend recusou iniciar (${fatalMessage.code}): ${fatalMessage.message}`);
      }
    });

    current.on('exit', (code) => onExit(current, code));

    readyTimer = setTimeoutFn(() => {
      if (current !== child || state !== 'starting') return;
      logger.error(`O backend não respondeu em ${Math.round(readyTimeoutMs / 1000)} s.`);
      state = 'failed';
      child = null;
      try {
        current.kill();
      } catch (err) {
        // já saiu
      }
      call('onStartupFailure', { code: 'START_TIMEOUT', message: '' });
    }, readyTimeoutMs);
  }

  function onExit(exited, code) {
    if (exited !== child) return; // processo antigo (timeout) ou já tratado
    clearTimeoutFn(readyTimer);
    child = null;
    logger.info(`Backend encerrou (código ${code}).`);

    if (state === 'stopping') {
      state = 'idle';
      const waiters = stopWaiters;
      stopWaiters = [];
      waiters.forEach((resolve) => resolve());
      return;
    }

    // Erro de inicialização (fatal, ou saída antes do primeiro ready): determinístico, não reinicia.
    if (fatalMessage || !everReady) {
      state = 'failed';
      const failure = fatalMessage || { code: 'BACKEND_EXITED', message: '' };
      call('onStartupFailure', failure);
      return;
    }

    // Queda depois de ter ficado pronto: política de reinício.
    crashTimes.push(now());
    const action = restartPolicy.nextAction({ crashTimes, now: now() });
    if (action.action === 'give-up') {
      state = 'failed';
      logger.error(`O backend caiu ${action.crashes} vezes em poucos minutos; desistindo.`);
      call('onGaveUp', { crashes: action.crashes });
      return;
    }
    state = 'restarting';
    logger.error(`O backend caiu (código ${code}); reinício ${action.attempt} em ${action.delayMs} ms.`);
    call('onRestarting', { attempt: action.attempt, delayMs: action.delayMs });
    restartTimer = setTimeoutFn(() => {
      restartTimer = null;
      if (state === 'restarting') spawn();
    }, action.delayMs);
  }

  return {
    start({ port: chosenPort }) {
      port = chosenPort;
      crashTimes = [];
      everReady = false;
      spawn();
    },

    // "Tentar de novo" depois de desistir: zera o contador e sobe de novo.
    retry() {
      if (state !== 'failed' || port === null) return;
      crashTimes = [];
      spawn();
    },

    // Pede o encerramento por mensagem (no Windows não há SIGTERM entre processos); mata se passar de 3 s.
    stop() {
      clearTimeoutFn(restartTimer);
      restartTimer = null;
      clearTimeoutFn(readyTimer);
      if (!child) {
        state = 'idle';
        return Promise.resolve();
      }
      state = 'stopping';
      const target = child;
      return new Promise((resolve) => {
        stopWaiters.push(resolve);
        try {
          target.postMessage({ type: 'shutdown' });
        } catch (err) {
          // canal fechado: o kill abaixo resolve
        }
        setTimeoutFn(() => {
          if (child === target) {
            logger.error('O backend não encerrou a tempo; forçando.');
            try {
              target.kill();
            } catch (err) {
              // já saiu
            }
            // Sem garantia do evento de saída; libera o chamador de qualquer forma.
            child = null;
            state = 'idle';
            const waiters = stopWaiters;
            stopWaiters = [];
            waiters.forEach((done) => done());
          }
        }, stopTimeoutMs);
      });
    },

    getState: () => state,
    getPort: () => port,
  };
}

module.exports = { createBackendSupervisor, READY_TIMEOUT_MS, STOP_TIMEOUT_MS };
