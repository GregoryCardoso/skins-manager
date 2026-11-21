'use strict';

// Máquina de estados da atualização dentro do app (D188), pura e testável. O main é o dono do estado; o renderer
// só exibe e pede ações do enum fechado abaixo. O estado nunca leva a URL de download.
const PHASES = ['idle', 'available', 'downloading', 'ready', 'installing', 'error', 'portable-available'];
const ACTIONS = ['download', 'later', 'restart', 'installOnQuit', 'dismiss', 'openDownloadPage'];
const MAX_ERROR_DETAIL = 500;

// Ações aceitas em cada fase. Fases ausentes (idle, downloading, installing) não aceitam nenhuma.
const ACTIONS_BY_PHASE = {
  available: ['download', 'later'],
  ready: ['restart', 'installOnQuit'],
  error: ['dismiss'],
  'portable-available': ['openDownloadPage', 'dismiss'],
};

function isActionAllowed(phase, action) {
  return Object.prototype.hasOwnProperty.call(ACTIONS_BY_PHASE, phase) && ACTIONS_BY_PHASE[phase].includes(action);
}

// Valida o payload de `desktop:updateRespond`: objeto simples com `action` do enum e `seq` inteiro.
// Campos extras (inclusive uma `url`) são descartados. Devolve `{ action, seq }` ou null.
function parseRespondPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const { action, seq } = payload;
  if (typeof action !== 'string' || !ACTIONS.includes(action)) return null;
  if (!Number.isSafeInteger(seq) || seq < 0) return null;
  return { action, seq };
}

function initialState({ mode = null, currentVersion = null } = {}) {
  return { seq: 0, phase: 'idle', mode, version: null, currentVersion, notes: '', percent: null, error: null };
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.floor(n)));
}

function errorDetail(detail) {
  const text = typeof detail === 'string' ? detail : detail === undefined || detail === null ? '' : String(detail);
  return text.length > MAX_ERROR_DETAIL ? text.slice(0, MAX_ERROR_DETAIL) : text;
}

// Aplica um evento. Devolve um novo estado (com `seq` + 1) ou o MESMO objeto quando o evento não vale na fase atual.
// Eventos de ação (o usuário): download, later, restart, installOnQuit, dismiss, openDownloadPage.
// Eventos internos: found, progress, downloaded, downloadFailed, installFailed, reopen, clear.
function transition(state, event) {
  const type = event && event.type;
  const next = (changes) => ({ ...state, ...changes, seq: state.seq + 1 });
  const toIdle = () => next({ phase: 'idle', version: null, notes: '', percent: null, error: null });

  switch (type) {
    case 'found':
      if (state.phase !== 'idle' && state.phase !== 'error') return state;
      return next({
        phase: state.mode === 'portable' ? 'portable-available' : 'available',
        version: event.version,
        currentVersion: event.currentVersion === undefined ? state.currentVersion : event.currentVersion,
        notes: typeof event.notes === 'string' ? event.notes : '',
        percent: null,
        error: null,
      });
    case 'download':
      if (!isActionAllowed(state.phase, 'download')) return state;
      return next({ phase: 'downloading', percent: 0, error: null });
    case 'progress': {
      if (state.phase !== 'downloading') return state;
      const percent = clampPercent(event.percent);
      return percent === state.percent ? state : next({ percent });
    }
    case 'downloaded':
      if (state.phase !== 'downloading') return state;
      return next({ phase: 'ready', percent: null, error: null });
    case 'downloadFailed':
      if (state.phase !== 'downloading') return state;
      return next({ phase: 'error', percent: null, error: { kind: 'download', detail: errorDetail(event.detail) } });
    case 'restart':
      if (!isActionAllowed(state.phase, 'restart')) return state;
      return next({ phase: 'installing' });
    case 'installFailed':
      if (state.phase !== 'installing') return state;
      return next({ phase: 'error', error: { kind: 'install', detail: errorDetail(event.detail) } });
    case 'reopen':
      // Atualização já baixada: o botão "Verificar atualizações" reabre o modal. Sempre muda o `seq`, para o
      // renderer saber que deve mostrar o modal de novo mesmo que a fase continue `ready`.
      if (state.phase !== 'idle' && state.phase !== 'ready' && state.phase !== 'error') return state;
      return next({ phase: 'ready', version: event.version, percent: null, error: null });
    case 'later':
    case 'installOnQuit':
    case 'dismiss':
    case 'openDownloadPage':
      return isActionAllowed(state.phase, type) ? toIdle() : state;
    case 'clear':
      return state.phase === 'error' ? toIdle() : state;
    default:
      return state;
  }
}

module.exports = {
  PHASES,
  ACTIONS,
  MAX_ERROR_DETAIL,
  isActionAllowed,
  parseRespondPayload,
  initialState,
  transition,
};
