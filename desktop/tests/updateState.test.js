'use strict';

const {
  PHASES,
  ACTIONS,
  MAX_ERROR_DETAIL,
  isActionAllowed,
  parseRespondPayload,
  initialState,
  transition,
} = require('../src/lib/updateState');

const base = (extra = {}) => ({ ...initialState({ mode: 'installer', currentVersion: '1.0.0' }), ...extra });
const FOUND = { type: 'found', version: '1.1.0', currentVersion: '1.0.0', notes: 'n' };

describe('initialState', () => {
  test('idle, seq 0, sem URL', () => {
    expect(initialState({ mode: 'portable', currentVersion: '1.0.0' })).toEqual({
      seq: 0,
      phase: 'idle',
      mode: 'portable',
      version: null,
      currentVersion: '1.0.0',
      notes: '',
      percent: null,
      error: null,
    });
    expect(initialState()).toMatchObject({ phase: 'idle', mode: null, seq: 0 });
  });
});

describe('isActionAllowed (tabela de D188)', () => {
  const table = {
    idle: [],
    available: ['download', 'later'],
    downloading: [],
    ready: ['restart', 'installOnQuit'],
    installing: [],
    error: ['dismiss'],
    'portable-available': ['openDownloadPage', 'dismiss'],
  };

  test('cada ação em cada fase', () => {
    expect(Object.keys(table).sort()).toEqual([...PHASES].sort());
    for (const phase of PHASES) {
      for (const action of ACTIONS) expect(isActionAllowed(phase, action)).toBe(table[phase].includes(action));
    }
  });

  test('fase ou ação desconhecida, e nomes do protótipo, nunca valem', () => {
    expect(isActionAllowed('nada', 'download')).toBe(false);
    expect(isActionAllowed('available', 'formatar')).toBe(false);
    expect(isActionAllowed('constructor', 'download')).toBe(false);
    expect(isActionAllowed('__proto__', 'download')).toBe(false);
    expect(isActionAllowed(undefined, undefined)).toBe(false);
  });
});

describe('parseRespondPayload', () => {
  test('aceita só { action, seq } e descarta o resto', () => {
    expect(parseRespondPayload({ action: 'download', seq: 4, url: 'https://x' })).toEqual({ action: 'download', seq: 4 });
    expect(parseRespondPayload({ action: 'later', seq: 0 })).toEqual({ action: 'later', seq: 0 });
  });

  test.each([
    [null],
    [undefined],
    ['a'],
    [3],
    [[]],
    [{}],
    [{ action: 'download' }],
    [{ seq: 1 }],
    [{ action: 'x', seq: 1 }],
    [{ action: 'download', seq: '1' }],
    [{ action: 'download', seq: 1.2 }],
    [{ action: 'download', seq: -1 }],
    [{ action: 'download', seq: NaN }],
    [{ action: 'download', seq: 2 ** 60 }],
  ])('recusa %j', (payload) => {
    expect(parseRespondPayload(payload)).toBeNull();
  });
});

describe('transition: transições válidas', () => {
  test('found: available (instalador) ou portable-available (portátil)', () => {
    const a = transition(base(), FOUND);
    expect(a).toEqual({ ...base(), seq: 1, phase: 'available', version: '1.1.0', notes: 'n' });
    const p = transition(base({ mode: 'portable' }), FOUND);
    expect(p.phase).toBe('portable-available');
    expect(transition(base({ phase: 'error', error: { kind: 'download', detail: 'x' } }), FOUND)).toMatchObject({
      phase: 'available',
      error: null,
    });
  });

  test('found sem notas string vira texto vazio', () => {
    expect(transition(base(), { ...FOUND, notes: undefined }).notes).toBe('');
  });

  test('fluxo completo e seq crescente', () => {
    const seqs = [];
    let s = base();
    const step = (event) => {
      const next = transition(s, event);
      expect(next).not.toBe(s);
      seqs.push(next.seq);
      s = next;
      return s;
    };
    expect(step(FOUND).phase).toBe('available');
    expect(step({ type: 'download' })).toMatchObject({ phase: 'downloading', percent: 0 });
    expect(step({ type: 'progress', percent: 33.7 }).percent).toBe(33);
    expect(step({ type: 'downloaded' })).toMatchObject({ phase: 'ready', percent: null });
    expect(step({ type: 'restart' }).phase).toBe('installing');
    expect(step({ type: 'installFailed', detail: 'x' })).toMatchObject({ phase: 'error', error: { kind: 'install', detail: 'x' } });
    expect(step({ type: 'reopen', version: '1.1.0' })).toMatchObject({ phase: 'ready', version: '1.1.0', error: null });
    expect(step({ type: 'installOnQuit' }).phase).toBe('idle');
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  test('later, dismiss, openDownloadPage e installOnQuit voltam a idle e limpam os dados', () => {
    const cases = [
      [{ phase: 'available', version: '1.1.0', notes: 'n' }, 'later'],
      [{ phase: 'error', error: { kind: 'download', detail: 'x' } }, 'dismiss'],
      [{ phase: 'portable-available', version: '1.1.0', notes: 'n' }, 'dismiss'],
      [{ phase: 'portable-available', version: '1.1.0', notes: 'n' }, 'openDownloadPage'],
      [{ phase: 'ready', version: '1.1.0' }, 'installOnQuit'],
    ];
    for (const [extra, type] of cases) {
      const next = transition(base({ ...extra, seq: 5 }), { type });
      expect(next).toMatchObject({ phase: 'idle', version: null, notes: '', percent: null, error: null, seq: 6 });
    }
  });

  test('downloadFailed: error/download, com detalhe de no máximo 500 caracteres', () => {
    const long = 'x'.repeat(900);
    const next = transition(base({ phase: 'downloading', percent: 5 }), { type: 'downloadFailed', detail: long });
    expect(next).toMatchObject({ phase: 'error', percent: null });
    expect(next.error.kind).toBe('download');
    expect(next.error.detail).toHaveLength(MAX_ERROR_DETAIL);
    expect(transition(base({ phase: 'downloading' }), { type: 'downloadFailed' }).error.detail).toBe('');
  });

  test('reopen vale em idle, ready e error, e sempre muda o seq', () => {
    for (const phase of ['idle', 'ready', 'error']) {
      const s = base({ phase, seq: 9 });
      const next = transition(s, { type: 'reopen', version: '1.1.0' });
      expect(next).toMatchObject({ phase: 'ready', version: '1.1.0', seq: 10 });
    }
  });

  test('clear: tira o erro; fora do erro não faz nada', () => {
    expect(transition(base({ phase: 'error', error: { kind: 'download', detail: 'x' } }), { type: 'clear' }).phase).toBe('idle');
    const s = base({ phase: 'available' });
    expect(transition(s, { type: 'clear' })).toBe(s);
  });

  test('progress: limita a 0..100 e ignora o mesmo ponto percentual', () => {
    const s = base({ phase: 'downloading', percent: 10 });
    expect(transition(s, { type: 'progress', percent: 250 }).percent).toBe(100);
    expect(transition(s, { type: 'progress', percent: -5 }).percent).toBe(0);
    expect(transition(s, { type: 'progress', percent: 'abc' }).percent).toBe(0);
    expect(transition(s, { type: 'progress', percent: 10.9 })).toBe(s);
  });

  test('não altera o estado recebido', () => {
    const s = Object.freeze(base());
    expect(() => transition(s, FOUND)).not.toThrow();
    expect(s.seq).toBe(0);
  });
});

describe('transition: eventos recusados devolvem o MESMO estado (sem mudar o seq)', () => {
  // [fase, eventos que não valem nela]
  const invalid = {
    idle: ['download', 'later', 'restart', 'installOnQuit', 'dismiss', 'openDownloadPage', 'progress', 'downloaded', 'downloadFailed', 'installFailed', 'clear'],
    available: ['found', 'restart', 'installOnQuit', 'dismiss', 'openDownloadPage', 'progress', 'downloaded', 'downloadFailed', 'installFailed', 'reopen', 'clear'],
    downloading: ['found', 'download', 'later', 'restart', 'installOnQuit', 'dismiss', 'openDownloadPage', 'installFailed', 'reopen', 'clear'],
    ready: ['found', 'download', 'later', 'dismiss', 'openDownloadPage', 'progress', 'downloaded', 'downloadFailed', 'installFailed', 'clear'],
    installing: ['found', 'download', 'later', 'restart', 'installOnQuit', 'dismiss', 'openDownloadPage', 'progress', 'downloaded', 'downloadFailed', 'reopen', 'clear'],
    error: ['download', 'later', 'restart', 'installOnQuit', 'openDownloadPage', 'progress', 'downloaded', 'downloadFailed', 'installFailed'],
    'portable-available': ['found', 'download', 'later', 'restart', 'installOnQuit', 'progress', 'downloaded', 'downloadFailed', 'installFailed', 'reopen', 'clear'],
  };

  test.each(Object.entries(invalid))('fase %s', (phase, types) => {
    for (const type of types) {
      const s = base({ phase, seq: 7 });
      expect(transition(s, { type, version: '1.1.0', percent: 50 })).toBe(s);
    }
  });

  test('evento desconhecido, nulo ou sem tipo', () => {
    const s = base();
    expect(transition(s, { type: 'formatar' })).toBe(s);
    expect(transition(s, null)).toBe(s);
    expect(transition(s, undefined)).toBe(s);
    expect(transition(s, {})).toBe(s);
  });

  test('o estado nunca ganha uma URL', () => {
    let s = transition(base(), { ...FOUND, url: 'https://evil.example/', html_url: 'https://evil.example/' });
    s = transition(s, { type: 'download', url: 'https://evil.example/' });
    expect(JSON.stringify(s)).not.toMatch(/https?:/);
    expect(Object.keys(s).sort()).toEqual(['currentVersion', 'error', 'mode', 'notes', 'percent', 'phase', 'seq', 'version']);
  });
});
