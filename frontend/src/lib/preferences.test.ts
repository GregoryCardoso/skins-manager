import { describe, expect, test, vi } from 'vitest';
import { BASE_LANGUAGE, LANGUAGES, matchLanguage } from '@/i18n/languages';
import {
  bootstrapPreferences,
  bootstrapScript,
  effectiveTheme,
  isThemeChoice,
  nextTheme,
  readCachedPreferences,
  shouldAdoptDetectedLanguage,
  toResolvedTheme,
  writeCachedPreferences,
} from './preferences';

function fakeStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  };
}

// Ambiente de idiomas que o `bootstrapScript` injeta no navegador (D369); `navigatorLocales` simula `navigator.languages`.
const LANG_ENV = { languages: LANGUAGES, baseLanguage: BASE_LANGUAGE, pickLanguage: matchLanguage, navigatorLocales: [] as string[] };

const throwing = () => {
  throw new Error('x');
};

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

describe('effectiveTheme / nextTheme (D112: só Claro e Escuro)', () => {
  test('a escolha salva vale sempre, qualquer que seja o tema do sistema', () => {
    expect(effectiveTheme('LIGHT', true)).toBe('LIGHT');
    expect(effectiveTheme('LIGHT', false)).toBe('LIGHT');
    expect(effectiveTheme('DARK', true)).toBe('DARK');
    expect(effectiveTheme('DARK', false)).toBe('DARK');
  });
  test('sem preferência (SYSTEM antigo, ausente, nulo ou inválido) usa o tema do sistema', () => {
    for (const saved of ['SYSTEM', undefined, null, '', 'dark', 'PURPLE']) {
      expect(effectiveTheme(saved, true)).toBe('DARK');
      expect(effectiveTheme(saved, false)).toBe('LIGHT');
    }
  });
  test('alterna Claro <-> Escuro, sem estado "Sistema"', () => {
    expect(nextTheme('LIGHT')).toBe('DARK');
    expect(nextTheme('DARK')).toBe('LIGHT');
    expect(nextTheme(nextTheme('LIGHT'))).toBe('LIGHT');
  });
  test('toResolvedTheme e isThemeChoice', () => {
    expect(toResolvedTheme('LIGHT')).toBe('light');
    expect(toResolvedTheme('DARK')).toBe('dark');
    expect(isThemeChoice('LIGHT')).toBe(true);
    expect(isThemeChoice('DARK')).toBe(true);
    expect(isThemeChoice('SYSTEM')).toBe(false);
    expect(isThemeChoice(undefined)).toBe(false);
  });
});

describe('cache', () => {
  test('lê valores válidos e ignora inválidos', () => {
    expect(readCachedPreferences(fakeStorage({ 'sm.theme': 'DARK', 'sm.language': 'en' }))).toEqual({ theme: 'DARK', language: 'en' });
    expect(readCachedPreferences(fakeStorage({ 'sm.theme': 'x', 'sm.language': 'fr' }))).toEqual({});
    expect(readCachedPreferences(fakeStorage())).toEqual({});
    expect(readCachedPreferences(null)).toEqual({});
  });
  test('SYSTEM antigo no cache é ignorado (= sem preferência)', () => {
    expect(readCachedPreferences(fakeStorage({ 'sm.theme': 'SYSTEM', 'sm.language': 'en' }))).toEqual({ language: 'en' });
  });
  test('theme null remove a escolha do cache', () => {
    const s = fakeStorage({ 'sm.theme': 'DARK', 'sm.language': 'en' });
    writeCachedPreferences({ theme: null }, s);
    expect(s.data).toEqual({ 'sm.language': 'en' });
  });
  test('storage que lança não quebra', () => {
    const boom = { getItem: throwing, setItem: throwing, removeItem: throwing };
    expect(readCachedPreferences(boom)).toEqual({});
    expect(() => writeCachedPreferences({ theme: 'DARK' }, boom)).not.toThrow();
    expect(() => writeCachedPreferences({ theme: null }, boom)).not.toThrow();
  });
  test('getItem que lança só em um campo ainda devolve objeto vazio sem lançar', () => {
    const boom = { getItem: (k: string) => { if (k === 'sm.language') throw new Error('x'); return 'DARK'; }, setItem: () => {}, removeItem: () => {} };
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

describe('shouldAdoptDetectedLanguage (instalação nova, D369)', () => {
  const base = { firstSettingsLoad: true, languageCachedAtStart: false, savedLanguage: 'en', detectedLanguage: 'pt-BR' };
  test('instalação nova com o Windows em outro idioma disponível: adota o idioma do sistema', () => {
    expect(shouldAdoptDetectedLanguage(base)).toBe(true);
  });
  test('instalação nova com o sistema em inglês ou em idioma indisponível (detectado = en): fica em inglês', () => {
    expect(shouldAdoptDetectedLanguage({ ...base, detectedLanguage: 'en' })).toBe(false);
  });
  test('quem já usa o app não muda nada: cache presente, banco em pt-BR ou leitura que não é a primeira', () => {
    expect(shouldAdoptDetectedLanguage({ ...base, languageCachedAtStart: true })).toBe(false);
    expect(shouldAdoptDetectedLanguage({ ...base, savedLanguage: 'pt-BR', detectedLanguage: 'en' })).toBe(false);
    expect(shouldAdoptDetectedLanguage({ ...base, savedLanguage: 'pt-BR' })).toBe(false);
    expect(shouldAdoptDetectedLanguage({ ...base, firstSettingsLoad: false })).toBe(false);
  });
});

describe('bootstrapPreferences', () => {
  test('tema escuro do sistema, sem idioma salvo e sem idioma do navegador: inglês (base), sem i18n-pending', () => {
    const { attrs, classes, doc } = fakeDoc();
    bootstrapPreferences({ ...LANG_ENV, doc, storage: fakeStorage(), matchMedia: () => ({ matches: true }) });
    expect(attrs['data-theme']).toBe('dark');
    expect(attrs.lang).toBe('en');
    expect(doc.documentElement.style.colorScheme).toBe('dark');
    expect(classes.has('i18n-pending')).toBe(false);
  });

  test('pt-BR em cache: i18n-pending e remoção agendada em 3 s', () => {
    const { attrs, classes, doc } = fakeDoc();
    const setTimeoutFn = vi.fn();
    bootstrapPreferences({
      ...LANG_ENV, doc, storage: fakeStorage({ 'sm.theme': 'LIGHT', 'sm.language': 'pt-BR' }),
      matchMedia: () => ({ matches: true }), setTimeoutFn,
    });
    expect(attrs['data-theme']).toBe('light');
    expect(attrs.lang).toBe('pt-BR');
    expect(classes.has('i18n-pending')).toBe(true);
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 3000);
    setTimeoutFn.mock.calls[0][0]();
    expect(classes.has('i18n-pending')).toBe(false);
  });

  test('escolha salva ignora o tema do sistema', () => {
    const a = fakeDoc();
    bootstrapPreferences({ doc: a.doc, storage: fakeStorage({ 'sm.theme': 'LIGHT' }), matchMedia: () => ({ matches: true }) });
    expect(a.attrs['data-theme']).toBe('light');
    const b = fakeDoc();
    bootstrapPreferences({ doc: b.doc, storage: fakeStorage({ 'sm.theme': 'DARK' }), matchMedia: () => ({ matches: false }) });
    expect(b.attrs['data-theme']).toBe('dark');
  });

  test('SYSTEM antigo no cache = sem preferência: segue o sistema', () => {
    const a = fakeDoc();
    bootstrapPreferences({ doc: a.doc, storage: fakeStorage({ 'sm.theme': 'SYSTEM' }), matchMedia: () => ({ matches: true }) });
    expect(a.attrs['data-theme']).toBe('dark');
    const b = fakeDoc();
    bootstrapPreferences({ doc: b.doc, storage: fakeStorage({ 'sm.theme': 'SYSTEM' }), matchMedia: () => ({ matches: false }) });
    expect(b.attrs['data-theme']).toBe('light');
  });

  test('grava colorScheme igual ao tema resolvido (sem preferência, sistema claro)', () => {
    const { attrs, doc } = fakeDoc();
    bootstrapPreferences({ doc, storage: fakeStorage(), matchMedia: () => ({ matches: false }) });
    expect(attrs['data-theme']).toBe('light');
    expect(doc.documentElement.style.colorScheme).toBe('light');
  });

  test('valores inválidos em cache caem no padrão (tema do sistema / inglês)', () => {
    const { attrs, classes, doc } = fakeDoc();
    bootstrapPreferences({
      ...LANG_ENV, doc, storage: fakeStorage({ 'sm.theme': 'PURPLE', 'sm.language': 'fr' }), matchMedia: () => ({ matches: true }),
    });
    expect(attrs['data-theme']).toBe('dark');
    expect(attrs.lang).toBe('en');
    expect(classes.has('i18n-pending')).toBe(false);
  });

  test('sem matchMedia (null) e storage null: tema claro, sem lançar', () => {
    const { attrs, doc } = fakeDoc();
    expect(() => bootstrapPreferences({ ...LANG_ENV, doc, storage: null, matchMedia: null })).not.toThrow();
    expect(attrs['data-theme']).toBe('light');
    expect(attrs.lang).toBe('en');
  });

  test('en explícito em cache não agenda timer', () => {
    const { doc } = fakeDoc();
    const setTimeoutFn = vi.fn();
    bootstrapPreferences({ ...LANG_ENV, doc, storage: fakeStorage({ 'sm.language': 'en' }), matchMedia: () => ({ matches: false }), setTimeoutFn });
    expect(setTimeoutFn).not.toHaveBeenCalled();
  });

  test('instalação nova (sem idioma salvo): usa o idioma do navegador se for um dos disponíveis; senão, o inglês', () => {
    for (const [locales, expected] of [[['pt-BR', 'en'], 'pt-BR'], [['pt-PT'], 'pt-BR'], [['ru-RU', 'pt-BR'], 'pt-BR'], [['en-US'], 'en'], [['ru-RU'], 'en'], [[], 'en']] as const) {
      const { attrs, doc } = fakeDoc();
      bootstrapPreferences({ ...LANG_ENV, navigatorLocales: [...locales], doc, storage: fakeStorage(), matchMedia: () => ({ matches: false }) });
      expect(attrs.lang).toBe(expected);
    }
  });

  test('idioma salvo vale sempre, mesmo com outro idioma no navegador (quem já usa o app não muda)', () => {
    const a = fakeDoc();
    bootstrapPreferences({ ...LANG_ENV, navigatorLocales: ['en-US'], doc: a.doc, storage: fakeStorage({ 'sm.language': 'pt-BR' }), matchMedia: () => ({ matches: false }) });
    expect(a.attrs.lang).toBe('pt-BR');
    const b = fakeDoc();
    bootstrapPreferences({ ...LANG_ENV, navigatorLocales: ['pt-BR'], doc: b.doc, storage: fakeStorage({ 'sm.language': 'en' }), matchMedia: () => ({ matches: false }) });
    expect(b.attrs.lang).toBe('en');
  });

  test('idioma do navegador a partir de navigator.languages (padrão)', () => {
    const { attrs, doc } = fakeDoc();
    const { navigatorLocales: _unused, ...env } = LANG_ENV;
    void _unused;
    vi.stubGlobal('navigator', { languages: ['pt-BR', 'en-US'], language: 'pt-BR' });
    bootstrapPreferences({ ...env, doc, storage: fakeStorage(), matchMedia: () => ({ matches: false }) });
    vi.unstubAllGlobals();
    expect(attrs.lang).toBe('pt-BR');
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
    const run = new Function('document', 'localStorage', 'window', 'setTimeout', 'navigator', script);
    run(doc, fakeStorage({ 'sm.theme': 'DARK' }), { matchMedia: () => ({ matches: false }) }, () => 0, { languages: [], language: '' });
    expect(attrs['data-theme']).toBe('dark');
    expect(attrs.lang).toBe('en');
  });

  test('script serializado: idioma do navegador numa instalação nova e idioma salvo (sem referenciar nada de fora)', () => {
    const script = bootstrapScript();
    const run = (storage: ReturnType<typeof fakeStorage>, languages: string[]) => {
      const { attrs, doc } = fakeDoc();
      new Function('document', 'localStorage', 'window', 'setTimeout', 'navigator', script)(
        doc, storage, { matchMedia: () => ({ matches: false }) }, () => 0, { languages, language: languages[0] },
      );
      return attrs.lang;
    };
    expect(run(fakeStorage(), ['pt-BR', 'en'])).toBe('pt-BR');
    expect(run(fakeStorage(), ['ja-JP'])).toBe('en');
    expect(run(fakeStorage({ 'sm.language': 'en' }), ['pt-BR'])).toBe('en');
  });
});
