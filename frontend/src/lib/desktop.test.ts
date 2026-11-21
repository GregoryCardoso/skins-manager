import { describe, expect, test } from 'vitest';
import { getDesktopBridge, getUpdateBridge, isUpdateResponse, isUpdateState, type UpdateState } from './desktop';

const fn = () => Promise.resolve({});

describe('getDesktopBridge', () => {
  test('sem window.skinsDesktop devolve null', () => {
    expect(getDesktopBridge({})).toBeNull();
    expect(getDesktopBridge(undefined)).toBeNull();
  });
  test('ponte incompleta devolve null', () => {
    expect(getDesktopBridge({ skinsDesktop: { isDesktop: true } })).toBeNull();
  });
  test('ponte completa', () => {
    const bridge = { isDesktop: true, getAppInfo: () => Promise.resolve({}), checkForUpdates: () => Promise.resolve({}) };
    expect(getDesktopBridge({ skinsDesktop: bridge })).toBe(bridge);
  });
});

describe('getDesktopBridge: casos extras', () => {
  test('window ausente ou de tipo errado', () => {
    expect(getDesktopBridge(null)).toBeNull();
    expect(getDesktopBridge('texto')).toBeNull();
    expect(getDesktopBridge(42)).toBeNull();
  });
  test('sem skinsDesktop no objeto window', () => {
    expect(getDesktopBridge({ document: {} })).toBeNull();
    expect(getDesktopBridge({ skinsDesktop: null })).toBeNull();
    expect(getDesktopBridge({ skinsDesktop: 'x' })).toBeNull();
  });
  test('isDesktop precisa ser exatamente true', () => {
    for (const isDesktop of [false, 'true', 1, undefined]) {
      expect(getDesktopBridge({ skinsDesktop: { isDesktop, getAppInfo: fn, checkForUpdates: fn } })).toBeNull();
    }
  });
  test('falta checkForUpdates ou getAppInfo (preload antigo)', () => {
    expect(getDesktopBridge({ skinsDesktop: { isDesktop: true, getAppInfo: fn } })).toBeNull();
    expect(getDesktopBridge({ skinsDesktop: { isDesktop: true, checkForUpdates: fn } })).toBeNull();
    expect(getDesktopBridge({ skinsDesktop: { isDesktop: true, getAppInfo: 'x', checkForUpdates: 'y' } })).toBeNull();
  });
  test('sem argumento, no ambiente node (sem window) devolve null', () => {
    expect(getDesktopBridge()).toBeNull();
  });
});

const baseBridge = { isDesktop: true, getAppInfo: fn, checkForUpdates: fn };
const fullBridge = { ...baseBridge, getUpdateState: fn, respondToUpdate: fn, onUpdateState: () => () => {} };

describe('getUpdateBridge (D188)', () => {
  test('ponte completa devolve a própria ponte', () => {
    expect(getUpdateBridge({ skinsDesktop: fullBridge })).toBe(fullBridge);
  });
  test('preload antigo, sem as funções novas, devolve null', () => {
    expect(getUpdateBridge({ skinsDesktop: baseBridge })).toBeNull();
    for (const missing of ['getUpdateState', 'respondToUpdate', 'onUpdateState'] as const) {
      const partial: Record<string, unknown> = { ...fullBridge };
      delete partial[missing];
      expect(getUpdateBridge({ skinsDesktop: partial })).toBeNull();
    }
  });
  test('funções novas de tipo errado devolvem null', () => {
    expect(getUpdateBridge({ skinsDesktop: { ...baseBridge, getUpdateState: 'x', respondToUpdate: 1, onUpdateState: {} } })).toBeNull();
  });
  test('sem ponte, sem window ou com isDesktop falso devolve null', () => {
    expect(getUpdateBridge({})).toBeNull();
    expect(getUpdateBridge(null)).toBeNull();
    expect(getUpdateBridge()).toBeNull();
    expect(getUpdateBridge({ skinsDesktop: { ...fullBridge, isDesktop: false } })).toBeNull();
  });
});

const goodState: UpdateState = {
  seq: 2,
  phase: 'available',
  mode: 'installer',
  version: '1.1.0',
  currentVersion: '1.0.0',
  notes: '## Novo',
  percent: null,
  error: null,
};

describe('isUpdateState', () => {
  test('aceita estados válidos de cada fase', () => {
    expect(isUpdateState(goodState)).toBe(true);
    expect(isUpdateState({ ...goodState, phase: 'downloading', percent: 40.5 })).toBe(true);
    expect(isUpdateState({ ...goodState, phase: 'error', error: { kind: 'install', detail: 'x' } })).toBe(true);
    expect(isUpdateState({ ...goodState, phase: 'idle', version: null, currentVersion: null, mode: null })).toBe(true);
    expect(isUpdateState({ ...goodState, phase: 'portable-available', mode: 'portable' })).toBe(true);
  });

  test.each([
    ['null', null],
    ['texto', 'x'],
    ['array', []],
    ['sem seq', { ...goodState, seq: undefined }],
    ['seq decimal', { ...goodState, seq: 1.5 }],
    ['seq negativo', { ...goodState, seq: -1 }],
    ['seq texto', { ...goodState, seq: '2' }],
    ['fase desconhecida', { ...goodState, phase: 'formatando' }],
    ['fase não texto', { ...goodState, phase: 3 }],
    ['modo inválido', { ...goodState, mode: 'web' }],
    ['version número', { ...goodState, version: 11 }],
    ['currentVersion número', { ...goodState, currentVersion: 1 }],
    ['notes ausente', { ...goodState, notes: undefined }],
    ['notes número', { ...goodState, notes: 5 }],
    ['percent acima de 100', { ...goodState, percent: 101 }],
    ['percent negativo', { ...goodState, percent: -1 }],
    ['percent NaN', { ...goodState, percent: NaN }],
    ['percent texto', { ...goodState, percent: '5' }],
    ['error texto', { ...goodState, error: 'x' }],
    ['error com tipo inválido', { ...goodState, error: { kind: 'rede', detail: 'x' } }],
    ['error sem detail', { ...goodState, error: { kind: 'download' } }],
  ])('recusa formato inválido: %s', (_n, value) => {
    expect(isUpdateState(value)).toBe(false);
  });
});

describe('isUpdateResponse', () => {
  test('exige accepted booleano e um estado válido', () => {
    expect(isUpdateResponse({ accepted: true, state: goodState })).toBe(true);
    expect(isUpdateResponse({ accepted: false, state: goodState })).toBe(true);
    expect(isUpdateResponse({ accepted: 'sim', state: goodState })).toBe(false);
    expect(isUpdateResponse({ accepted: true, state: { seq: 1 } })).toBe(false);
    expect(isUpdateResponse({ accepted: true })).toBe(false);
    expect(isUpdateResponse(null)).toBe(false);
  });
});
