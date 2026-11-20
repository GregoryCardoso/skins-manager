import { describe, expect, test, vi } from 'vitest';
import {
  bootstrapPreferences,
  bootstrapScript,
  nextTheme,
  readCachedPreferences,
  resolveTheme,
  writeCachedPreferences,
} from './preferences';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

function fakeDoc() {
  const attrs: Record<string, string> = {};
  const classes = new Set<string>();
  const documentElement = {
    setAttribute: (n: string, v: string) => {
      attrs[n] = v;
    },
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    style: { colorScheme: '' },
  };
  return { attrs, classes, doc: { documentElement } };
}

describe('resolveTheme / nextTheme', () => {
  test('resolveTheme', () => {
    expect(resolveTheme('LIGHT', true)).toBe('light');
    expect(resolveTheme('LIGHT', false)).toBe('light');
    expect(resolveTheme('DARK', true)).toBe('dark');
    expect(resolveTheme('DARK', false)).toBe('dark');
    expect(resolveTheme('SYSTEM', true)).toBe('dark');
    expect(resolveTheme('SYSTEM', false)).toBe('light');
  });
  test('ciclo Sistema -> Claro -> Escuro -> Sistema', () => {
    expect(nextTheme('SYSTEM')).toBe('LIGHT');
    expect(nextTheme('LIGHT')).toBe('DARK');
    expect(nextTheme('DARK')).toBe('SYSTEM');
  });
});

describe('cache', () => {
  test('lê valores válidos e ignora inválidos', () => {
    expect(readCachedPreferences(fakeStorage({ 'sm.theme': 'DARK', 'sm.language': 'en' }))).toEqual({ theme: 'DARK', language: 'en' });
    expect(readCachedPreferences(fakeStorage({ 'sm.theme': 'x', 'sm.language': 'fr' }))).toEqual({});
    expect(readCachedPreferences(fakeStorage())).toEqual({});
    expect(readCachedPreferences(null)).toEqual({});
  });
  test('storage que lança não quebra', () => {
    const boom = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readCachedPreferences(boom)).toEqual({});
    expect(() => writeCachedPreferences({ theme: 'DARK' }, boom)).not.toThrow();
  });
  test('getItem que lança só em um campo ainda devolve objeto vazio sem lançar', () => {
    const boom = { getItem: (k: string) => { if (k === 'sm.language') throw new Error('x'); return 'DARK'; }, setItem: () => {} };
    expect(() => readCachedPreferences(boom)).not.toThrow();
  });
  test('grava tema e idioma; storage null não lança', () => {
    const s = fakeStorage();
    writeCachedPreferences({ theme: 'DARK', language: 'en' }, s);
    expect(s.data).toEqual({ 'sm.theme': 'DARK', 'sm.language': 'en' });
    expect(() => writeCachedPreferences({ theme: 'DARK' }, null)).not.toThrow();
  });
  test('localStorage global que lança ao ser acessado não quebra o padrão', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readCachedPreferences()).toEqual({});
    vi.unstubAllGlobals();
  });
  test('grava só os campos informados', () => {
    const s = fakeStorage();
    writeCachedPreferences({ theme: 'LIGHT' }, s);
    expect(s.data).toEqual({ 'sm.theme': 'LIGHT' });
  });
});

describe('bootstrapPreferences', () => {
  test('tema escuro do sistema, pt-BR: sem i18n-pending', () => {
    const { attrs, classes, doc } = fakeDoc();
    bootstrapPreferences({ doc, storage: fakeStorage(), matchMedia: () => ({ matches: true }) });
    expect(attrs['data-theme']).toBe('dark');
    expect(attrs.lang).toBe('pt-BR');
    expect(doc.documentElement.style.colorScheme).toBe('dark');
    expect(classes.has('i18n-pending')).toBe(false);
  });

  test('en em cache: i18n-pending e remoção agendada em 3 s', () => {
    const { attrs, classes, doc } = fakeDoc();
    const setTimeoutFn = vi.fn();
    bootstrapPreferences({
      doc, storage: fakeStorage({ 'sm.theme': 'LIGHT', 'sm.language': 'en' }),
      matchMedia: () => ({ matches: true }), setTimeoutFn,
    });
    expect(attrs['data-theme']).toBe('light');
    expect(attrs.lang).toBe('en');
    expect(classes.has('i18n-pending')).toBe(true);
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 3000);
    setTimeoutFn.mock.calls[0][0]();
    expect(classes.has('i18n-pending')).toBe(false);
  });

  test('grava colorScheme igual ao tema resolvido (SYSTEM claro)', () => {
    const { attrs, doc } = fakeDoc();
    bootstrapPreferences({ doc, storage: fakeStorage(), matchMedia: () => ({ matches: false }) });
    expect(attrs['data-theme']).toBe('light');
    expect(doc.documentElement.style.colorScheme).toBe('light');
  });

  test('valores inválidos em cache caem no padrão (SYSTEM / pt-BR)', () => {
    const { attrs, classes, doc } = fakeDoc();
    bootstrapPreferences({
      doc, storage: fakeStorage({ 'sm.theme': 'PURPLE', 'sm.language': 'fr' }), matchMedia: () => ({ matches: true }),
    });
    expect(attrs['data-theme']).toBe('dark');
    expect(attrs.lang).toBe('pt-BR');
    expect(classes.has('i18n-pending')).toBe(false);
  });

  test('sem matchMedia (null) e storage null: tema claro, sem lançar', () => {
    const { attrs, doc } = fakeDoc();
    expect(() => bootstrapPreferences({ doc, storage: null, matchMedia: null })).not.toThrow();
    expect(attrs['data-theme']).toBe('light');
    expect(attrs.lang).toBe('pt-BR');
  });

  test('pt-BR explícito em cache não agenda timer', () => {
    const { doc } = fakeDoc();
    const setTimeoutFn = vi.fn();
    bootstrapPreferences({ doc, storage: fakeStorage({ 'sm.language': 'pt-BR' }), matchMedia: () => ({ matches: false }), setTimeoutFn });
    expect(setTimeoutFn).not.toHaveBeenCalled();
  });

  test('nunca lança, mesmo com tudo quebrado', () => {
    expect(() => bootstrapPreferences({
      doc: { get documentElement(): never { throw new Error('x'); } } as never,
    })).not.toThrow();
    const { doc } = fakeDoc();
    expect(() => bootstrapPreferences({
      doc, storage: { getItem: () => { throw new Error('x'); }, setItem: () => {} },
      matchMedia: () => { throw new Error('x'); },
    })).not.toThrow();
  });

  test('script serializado é autossuficiente e executável', () => {
    const script = bootstrapScript();
    expect(script.startsWith('(')).toBe(true);
    const { attrs, doc } = fakeDoc();
    const run = new Function('document', 'localStorage', 'window', 'setTimeout', script);
    run(doc, fakeStorage({ 'sm.theme': 'DARK' }), { matchMedia: () => ({ matches: false }) }, () => 0);
    expect(attrs['data-theme']).toBe('dark');
  });
});
