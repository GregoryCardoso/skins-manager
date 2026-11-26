import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { BASE_DICTIONARY, loadDictionary } from './dictionaries';
import { LANGUAGES, intlLocaleOf, languageOrBase, matchLanguage } from './languages';
import { formatCentsInput, formatDecimalInput, usesCommaDecimal } from '@/lib/numberInput';
import { rateToPercentText } from '@/lib/storeForm';

const requireFromHere = createRequire(__filename);
const root = path.join(__dirname, '..', '..', '..');

// Os três registros de idiomas (D369) precisam ter os mesmos códigos E a mesma ordem (B1, 11.11): backend (grava/valida), frontend
// (seletor) e desktop (diálogos nativos). Ordem = alfabética pelo nome nativo, latinas, cirílico e CJK. Lidos como texto/módulo, sem abrir banco.
const DISPLAY_ORDER = ['de', 'en', 'es', 'fr', 'it', 'pl', 'pt-BR', 'tr', 'ru', 'uk', 'ja', 'zh-CN', 'ko'];

describe('os três registros de idiomas têm os mesmos códigos, na mesma ordem', () => {
  test('a ordem de exibição é a esperada e o inglês segue como idioma base', () => {
    expect([...LANGUAGES]).toEqual(DISPLAY_ORDER);
  });

  test('backend LANGUAGES = frontend LANGUAGE_REGISTRY', () => {
    const text = fs.readFileSync(path.join(root, 'backend', 'src', 'config', 'constants.js'), 'utf8');
    const match = /const LANGUAGES = Object\.freeze\(\[([^\]]*)\]\)/.exec(text);
    expect(match).not.toBeNull();
    const backend = [...(match as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(backend.length).toBeGreaterThan(0);
    expect(backend).toEqual([...LANGUAGES]);
  });

  test('desktop MESSAGES = frontend LANGUAGE_REGISTRY', () => {
    const text = fs.readFileSync(path.join(root, 'desktop', 'src', 'i18n.js'), 'utf8');
    const start = text.indexOf('const MESSAGES = {');
    const end = text.indexOf('\n};', start);
    const codes = [...text.slice(start, end).matchAll(/^ {2}'?([\w-]+)'?: \{/gm)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes).toEqual([...LANGUAGES]);
  });
});

// A mesma tabela vale para o frontend (matchLanguage) e para o desktop (languageFromLocale), que têm de concordar.
const CASES: [string, string][] = [
  ['pt', 'pt-BR'], ['pt-PT', 'pt-BR'], ['pt_BR', 'pt-BR'], ['PT-br', 'pt-BR'], [' pt-BR ', 'pt-BR'],
  ['en-US', 'en'], ['EN', 'en'], ['sv-SE', 'en'], ['', 'en'], ['es-MX', 'es'], ['es', 'es'], ['fr-FR', 'fr'], ['fr_CA', 'fr'], ['it-IT', 'it'], ['de-AT', 'de'], ['DE', 'de'], ['ru-RU', 'ru'], ['uk-UA', 'uk'], ['pl_PL', 'pl'], ['tr-TR', 'tr'], ['zh-CN', 'zh-CN'], ['zh', 'zh-CN'], ['ja-JP', 'ja'], ['ko_KR', 'ko'], ['---', 'en'],
  ['zh-TW', 'en'], ['zh-HK', 'en'], ['zh-Hant', 'en'], ['zh-Hant-TW', 'en'],
];

describe('idioma do sistema -> idioma disponível (frontend e desktop concordam)', () => {
  test.each(CASES)('frontend %j -> %s', (locale, expected) => {
    expect(matchLanguage([locale], LANGUAGES, 'en')).toBe(expected);
  });

  test.each(CASES)('desktop %j -> %s', (locale, expected) => {
    const { languageFromLocale } = requireFromHere(path.join(root, 'desktop', 'src', 'i18n.js'));
    expect(languageFromLocale(locale)).toBe(expected);
  });

  test('o chinês tradicional não vira o simplificado quando zh-CN existe', () => {
    const available = ['en', 'zh-CN'];
    for (const tag of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh_Hant_TW']) expect(matchLanguage([tag], available, 'en')).toBe('en');
    for (const tag of ['zh', 'zh-CN', 'zh-Hans', 'zh-SG']) expect(matchLanguage([tag], available, 'en')).toBe('zh-CN');
  });
});

describe('idioma fora do registro não derruba a interface (M1)', () => {
  test('languageOrBase', () => {
    expect(languageOrBase('sv')).toBe('en');
    expect(languageOrBase('pt-br')).toBe('en');
    expect(languageOrBase(undefined)).toBe('en');
    expect(languageOrBase(null)).toBe('en');
    expect(languageOrBase(5)).toBe('en');
    expect(languageOrBase('pt-BR')).toBe('pt-BR');
    for (const code of ['es', 'fr', 'it', 'de', 'ru', 'uk', 'pl', 'tr', 'zh-CN', 'ja', 'ko']) expect(languageOrBase(code)).toBe(code);
  });

  test('loadDictionary sem loader devolve o inglês, sem lançar erro', async () => {
    await expect(loadDictionary('sv')).resolves.toBe(BASE_DICTIONARY);
    await expect(loadDictionary('__proto__')).resolves.toBe(BASE_DICTIONARY);
    await expect(loadDictionary('toString')).resolves.toBe(BASE_DICTIONARY);
    for (const code of ['pt-BR', 'es', 'fr', 'it', 'de', 'ru', 'uk', 'pl', 'tr', 'zh-CN', 'ja', 'ko']) await expect(loadDictionary(code)).resolves.not.toBe(BASE_DICTIONARY);
  });

  test('PreferencesProvider usa languageOrBase onde o idioma do servidor entra', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'components', 'PreferencesProvider.tsx'), 'utf8');
    expect(source.match(/languageOrBase\(settingsData\.language\)/g)?.length).toBe(2);
    expect(source).not.toMatch(/setLanguageState\(settingsData\.language\)/);
  });
});

describe('formatação sempre pelo locale do registro (M5)', () => {
  test('intlLocaleOf é idempotente e cai no inglês quando desconhecido', () => {
    for (const code of LANGUAGES) expect(intlLocaleOf(intlLocaleOf(code))).toBe(intlLocaleOf(code));
    expect(intlLocaleOf('xx')).toBe('en');
  });

  test('campos de edição formatam com o locale do registro', () => {
    expect(formatDecimalInput(5.4, 'pt-BR')).toBe('5,4');
    expect(formatDecimalInput(5.4, 'en')).toBe('5.4');
    expect(formatDecimalInput(5.4, 'xx')).toBe('5.4');
    expect(formatCentsInput(125, 'pt-BR')).toBe('1,25');
    expect(formatCentsInput(125, 'en')).toBe('1.25');
    expect(rateToPercentText(0.025, 'pt-BR')).toBe('2,5');
    expect(rateToPercentText(0.025, 'en')).toBe('2.5');
  });

  test('usesCommaDecimal responde igual nas chamadas repetidas (cache por locale)', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(usesCommaDecimal('pt-BR')).toBe(true);
      expect(usesCommaDecimal('en')).toBe(false);
    }
  });

  test('nenhum componente usa o código do idioma (useLanguage) direto no Intl', () => {
    const dir = path.join(__dirname, '..');
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const offenders = walk(dir)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
      .filter((f) => /new Intl\.\w+\(\s*language\b/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(dir, f));
    expect(offenders).toEqual([]);
  });
});

describe('I18nProvider (5b e 5c)', () => {
  const source = fs.readFileSync(path.join(__dirname, 'I18nProvider.tsx'), 'utf8');

  test('o contexto expõe o idioma do dicionário carregado e há useLocale', () => {
    expect(source).toMatch(/return \{ language: loaded\.language,/);
    expect(source).toMatch(/export const useLocale = \(\): string => intlLocaleOf\(useI18n\(\)\.language\)/);
  });

  test('falha no import() tenta de novo (foco da janela e temporizador) e não prende a tela', () => {
    expect(source).toContain("window.addEventListener('focus', retry)");
    expect(source).toContain('setTimeout(retry, DICTIONARY_RETRY_MS)');
    expect(source).toMatch(/dictionaryReady = loaded\.language === language \|\| failedFor === language/);
    expect(source).not.toMatch(/setLoaded\(\{ language, messages: BASE_DICTIONARY \}\)/);
  });
});
