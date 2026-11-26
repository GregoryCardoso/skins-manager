import { describe, expect, test } from 'vitest';
import en from './en.json';
import ptBR from './pt-BR.json';
import { BASE_LANGUAGE, LANGUAGES, detectLanguage, matchLanguage } from './languages';
import { translate, translatePlural } from './translate';
import { bootstrapPreferences, bootstrapScript, shouldAdoptDetectedLanguage } from '@/lib/preferences';
import { formatCentsInput, normalizeNumberText, parseDecimalInput, parseFloatInput, parseMoneyToCents, usesCommaDecimal } from '@/lib/numberInput';
import { selectReleaseNotes } from '@/lib/releaseNotes';

// QA 11.1 (D369): casos de borda da base dos idiomas.

// Percorre um dicionário e devolve os caminhos dos objetos que são grupos de plural (têm `one` ou `other` como texto).
function pluralGroups(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object') return [];
  const obj = node as Record<string, unknown>;
  const keys = Object.keys(obj);
  const isPlural = typeof obj.other === 'string' && keys.every((key) => ['zero', 'one', 'two', 'few', 'many', 'other'].includes(key));
  const here = isPlural ? [prefix] : [];
  return [...here, ...Object.entries(obj).flatMap(([key, value]) => pluralGroups(value, prefix ? `${prefix}.${key}` : key))];
}

describe('plural com os textos reais de en e pt-BR', () => {
  const groups = pluralGroups(en);
  test('há grupos de plural e todos existem nos dois idiomas, só com categorias zero/one/other e sempre com other', () => {
    expect(groups.length).toBeGreaterThan(5);
    expect(pluralGroups(ptBR).sort()).toEqual([...groups].sort());
    for (const dict of [en, ptBR]) {
      for (const path of groups) {
        const node = path.split('.').reduce<Record<string, unknown>>((acc, part) => acc[part] as Record<string, unknown>, dict as unknown as Record<string, unknown>);
        expect(Object.keys(node).every((key) => ['zero', 'one', 'other'].includes(key))).toBe(true);
        expect(typeof node.other).toBe('string');
      }
    }
  });

  test.each(['en', 'pt-BR'] as const)('%s: nenhum número (0, 1, 2, 5, 11, 21, 101, negativos, decimais, 1 milhão) devolve a chave nem deixa {count} sem trocar', (locale) => {
    const dict = locale === 'en' ? en : ptBR;
    const counts = [0, 1, 2, 5, 11, 12, 14, 21, 22, 25, 101, 111, -1, -2, 0.5, 1.5, 1_000_000, 2_000_000];
    for (const path of groups) {
      for (const count of counts) {
        const text = translatePlural(dict, path, count, locale, { groups: 2, total: 3 });
        expect(text).not.toContain(path);
        expect(text).not.toContain('{count}');
        // (alguns grupos não usam {count}: o texto só precisa ser um texto, não a chave)
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });

  test('categorias do pt-BR (comportamento atual e idêntico ao anterior): 0, 1 e 1,5 usam "one"; 2 usa "other"', () => {
    expect(new Intl.PluralRules('pt-BR').select(0)).toBe('one');
    expect(new Intl.PluralRules('pt-BR').select(1.5)).toBe('one');
    expect(new Intl.PluralRules('en').select(0)).toBe('other');
    // 11.6: a chave `zero` (quando existe) vale para a contagem 0 em qualquer idioma
    expect(translatePlural(ptBR, 'sales.count', 0, 'pt-BR')).toBe('Nenhuma venda');
    expect(translatePlural(en, 'sales.count', 0, 'en')).toBe('No sales');
    expect(translatePlural(ptBR, 'common.dayCount', 0, 'pt-BR')).toBe('0 dias'); // B1 (11.6): `zero` = "{count} dias"
  });

  test('ru/uk/pl com os cortes 0, 1, 2, 5, 11, 12, 14, 21, 22, 25, 101, 111, negativos e decimais', () => {
    const d = { n: { one: 'ONE', few: 'FEW', many: 'MANY', other: 'OTHER' } };
    const row = (locale: string) => [0, 1, 2, 5, 11, 12, 14, 21, 22, 25, 101, 111, -1, -2, 1.5, 0.5].map((n) => translatePlural(d, 'n', n, locale));
    expect(row('ru')).toEqual(['MANY', 'ONE', 'FEW', 'MANY', 'MANY', 'MANY', 'MANY', 'ONE', 'FEW', 'MANY', 'ONE', 'MANY', 'ONE', 'FEW', 'OTHER', 'OTHER']);
    expect(row('uk')).toEqual(row('ru'));
    expect(row('pl')).toEqual(['MANY', 'ONE', 'FEW', 'MANY', 'MANY', 'MANY', 'MANY', 'MANY', 'FEW', 'MANY', 'MANY', 'MANY', 'ONE', 'FEW', 'OTHER', 'OTHER']);
  });

  test('locale inválido não lança e cai em other', () => {
    expect(translatePlural({ n: { one: 'U', other: 'O' } }, 'n', 1, 'não é locale!!')).toBe('O');
  });
});

describe('reserva para o inglês', () => {
  test('chave ausente no pt-BR mostra o inglês, com os {marcadores} trocados nos dois casos', () => {
    const base = { a: { b: 'Hello {name}' }, only: 'Only {x} here' };
    const own = { a: { b: 'Olá {name}' } };
    expect(translate(own, 'a.b', { name: 'Ana' }, base)).toBe('Olá Ana');
    expect(translate(own, 'only', { x: 7 }, base)).toBe('Only 7 here');
    expect(translate(own, 'only', undefined, base)).toBe('Only {x} here');
    expect(translate(own, 'nada', undefined, base)).toBe('nada');
  });
  test('valor não string no meio do caminho (objeto) não é tratado como texto', () => {
    expect(translate({ a: { b: 'x' } }, 'a', undefined, { a: 'Base' })).toBe('Base');
  });
  test('chave "constructor"/"__proto__" não vaza do protótipo', () => {
    expect(translate({}, 'constructor', undefined, {})).toBe('constructor');
    expect(translate({}, '__proto__.x', undefined, {})).toBe('__proto__.x');
  });
});

describe('detecção do idioma inicial: casos de borda', () => {
  test('lista vazia, com lixo e com tags estranhas cai no inglês sem lançar', () => {
    expect(detectLanguage([])).toBe('en');
    expect(detectLanguage(['', '   ', '*', 'x-y-z', '123', '-', 'x-'.repeat(5)])).toBe('en');
    // @ts-expect-error entradas não string vindas do navegador
    expect(detectLanguage([null, undefined, 5, {}])).toBe('en');
    // @ts-expect-error undefined no lugar da lista
    expect(() => matchLanguage(undefined, LANGUAGES, 'en')).toThrow();
  });
  test('pt, pt-PT, pt-BR, pt-Latn-BR e variantes', () => {
    expect(detectLanguage(['pt'])).toBe('pt-BR');
    expect(detectLanguage(['pt-PT'])).toBe('pt-BR');
    expect(detectLanguage(['pt-BR'])).toBe('pt-BR');
    expect(detectLanguage(['PT_br'])).toBe('pt-BR');
    expect(detectLanguage(['pt-Latn-BR'])).toBe('pt-BR');
  });
  test('chinês: o simplificado está no registro (11.9) e o tradicional nunca vira simplificado', () => {
    expect(detectLanguage(['zh-Hans-CN'])).toBe('zh-CN');
    expect(detectLanguage(['zh-TW'])).toBe('en');
    const available = ['en', 'zh-CN'];
    expect(matchLanguage(['zh-Hans-CN'], available, 'en')).toBe('zh-CN');
    expect(matchLanguage(['zh'], available, 'en')).toBe('zh-CN');
    for (const tag of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-TW', 'zh_tw']) expect(matchLanguage([tag], available, 'en')).toBe('en');
    expect(matchLanguage(['zh-TW', 'zh-CN'], available, 'en')).toBe('zh-CN');
  });
  test('ordem do navegador manda: o primeiro idioma disponível vence', () => {
    expect(detectLanguage(['sv-SE', 'pt-BR', 'en-US'])).toBe('pt-BR');
    expect(detectLanguage(['en-US', 'pt-BR'])).toBe('en');
  });
});

describe('bootstrap: prioridade entre cache e navegador', () => {
  const run = (storedLanguage: string | null, navigatorLocales: string[] | null | undefined) => {
    const attrs: Record<string, string> = {};
    const classes = new Set<string>();
    const doc = {
      documentElement: {
        setAttribute: (n: string, v: string) => { attrs[n] = v; },
        classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
        style: { colorScheme: '' },
      },
    };
    bootstrapPreferences({
      doc,
      storage: { getItem: (k: string) => (k === 'sm.language' ? storedLanguage : null), setItem: () => {} },
      matchMedia: () => ({ matches: false }),
      setTimeoutFn: () => 0,
      languages: LANGUAGES,
      baseLanguage: BASE_LANGUAGE,
      pickLanguage: matchLanguage,
      navigatorLocales,
    });
    return { lang: attrs.lang, pending: classes.has('i18n-pending') };
  };
  test('cache en vence um navegador em português (quem escolheu en continua em en)', () => {
    expect(run('en', ['pt-BR']).lang).toBe('en');
  });
  test('cache pt-BR vence um navegador em inglês', () => {
    expect(run('pt-BR', ['en-US']).lang).toBe('pt-BR');
  });
  test('sem cache: navegador em português -> pt-BR com i18n-pending; null/undefined/[] -> en', () => {
    expect(run(null, ['pt-PT'])).toEqual({ lang: 'pt-BR', pending: true });
    expect(run(null, null)).toEqual({ lang: 'en', pending: true });
    expect(run(null, [])).toEqual({ lang: 'en', pending: true });
  });
  test('cache com idioma desconhecido (sv, "pt-br") é ignorado e vale o navegador', () => {
    expect(run('sv', ['pt-BR']).lang).toBe('pt-BR');
    expect(run('pt-br', ['en']).lang).toBe('en');
  });
  test('o script serializado carrega o registro e a função de detecção', () => {
    const script = bootstrapScript();
    expect(script).toContain('"pt-BR"');
    expect(script).not.toContain('import(');
    expect(() => new Function(script)).not.toThrow();
  });
});

describe('shouldAdoptDetectedLanguage: heurística "en padrão" x "en escolhido" (documentação do comportamento atual)', () => {
  const base = { firstSettingsLoad: true, languageCachedAtStart: false, savedLanguage: 'en', detectedLanguage: 'pt-BR' };
  test('instalação nova (sem cache, banco em en) com Windows em pt-BR adota pt-BR', () => {
    expect(shouldAdoptDetectedLanguage(base)).toBe(true);
  });
  test('quem já tem pt-BR salvo nunca é trocado, nem com o navegador em inglês', () => {
    expect(shouldAdoptDetectedLanguage({ ...base, savedLanguage: 'pt-BR' })).toBe(false);
    expect(shouldAdoptDetectedLanguage({ ...base, savedLanguage: 'pt-BR', detectedLanguage: 'en' })).toBe(false);
  });
  test('LIMITAÇÃO CONHECIDA: o app não distingue "en escolhido" de "en padrão". Quem escolheu en e limpou o cache do navegador (cache vazio, banco em en) é trocado para o idioma do sistema', () => {
    // Mesma entrada de uma instalação nova: indistinguível, porque o banco só guarda o código ('en' gravado = 'en' padrão).
    expect(shouldAdoptDetectedLanguage({ ...base })).toBe(true);
  });
  test('cache presente protege quem escolheu en; segunda leitura nunca troca', () => {
    expect(shouldAdoptDetectedLanguage({ ...base, languageCachedAtStart: true })).toBe(false);
    expect(shouldAdoptDetectedLanguage({ ...base, firstSettingsLoad: false })).toBe(false);
  });
});

describe('numberInput: separador decimal pelo Intl e regressão do pt-BR', () => {
  // Implementação anterior à 11.1 (idioma fixo pt-BR = vírgula), usada como oráculo de regressão.
  const oldNormalize = (text: string, language: string) => {
    const raw = text.trim().replace(/\s+/g, '');
    if (language === 'pt-BR') return raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
    return raw.includes('.') ? raw.replace(/,/g, '') : raw.replace(',', '.');
  };
  const inputs = ['1.234', '1,234', '1.234,5', '1,234.5', '1.234,56', '1 234,5', '1 234,5', '1 234,5', '  5,40 ', '5.40', '5,', ',5', '.5', '-5', '+5', '1e3', '0', '0,00', '', ' ', '1.2.3', '1,2,3', '1,2.3', 'abc', '١٢٣', '１２３', '12 345,67', '1.000.000,01'];

  test.each(['en', 'pt-BR'])('normalizeNumberText em %s é igual ao comportamento anterior para todas as entradas', (language) => {
    for (const input of inputs) expect(normalizeNumberText(input, language)).toBe(oldNormalize(input, language));
  });

  test('usesCommaDecimal: en/ja/ko/zh ponto; pt-BR/de/fr/es/ru/pl/uk/tr/it vírgula; código desconhecido ou lixo -> ponto sem lançar', () => {
    for (const l of ['en', 'ja', 'ko', 'zh-CN']) expect(usesCommaDecimal(l)).toBe(false);
    for (const l of ['pt-BR', 'de', 'fr', 'es', 'ru', 'pl', 'uk', 'tr', 'it']) expect(usesCommaDecimal(l)).toBe(true);
    for (const l of ['xx', '', 'não é locale', 'pt-br']) expect(() => usesCommaDecimal(l)).not.toThrow();
    expect(usesCommaDecimal('xx')).toBe(false);
  });

  test('entradas ambíguas em en e pt-BR (valores concretos)', () => {
    // en: ponto decimal, vírgula milhar
    expect(parseDecimalInput('1.234', 'en')).toBe(1.234);
    expect(parseDecimalInput('1,234', 'en')).toBeNull(); // "1,234" sem ponto: ambíguo (1,234 ou 1234), recusado (B6, 11.11)
    expect(parseDecimalInput('5,4', 'en')).toBe(5.4); // a vírgula decimal sem 3 dígitos continua aceita
    expect(parseDecimalInput('1,234.5', 'en')).toBe(1234.5);
    expect(parseDecimalInput('1 234.5', 'en')).toBe(1234.5);
    // pt-BR: vírgula decimal, ponto milhar
    expect(parseDecimalInput('1.234,5', 'pt-BR')).toBe(1234.5);
    expect(parseDecimalInput('1.234', 'pt-BR')).toBeNull(); // sem vírgula, "1.234" é ambíguo (1,234 ou 1234), recusado (B6, 11.11)
    expect(parseDecimalInput('5.4', 'pt-BR')).toBe(5.4);
    expect(parseDecimalInput('1,234', 'pt-BR')).toBe(1.234);
    expect(parseDecimalInput('1 234,5', 'pt-BR')).toBe(1234.5); // NBSP é espaço para \s
    expect(parseDecimalInput('1 234,5', 'pt-BR')).toBe(1234.5); // espaço fino estreito (Intl de pt-BR/fr)
  });

  test('sinal, vazio, zero e lixo -> null; money e float seguem as mesmas regras', () => {
    for (const lang of ['en', 'pt-BR']) {
      for (const bad of ['-5', '+5', '1e3', '', ' ', 'abc', '5,', ',5', '1.2.3', '0']) expect(parseDecimalInput(bad, lang)).toBeNull();
      expect(parseMoneyToCents('-1', lang)).toBeNull();
      expect(parseMoneyToCents('1,239', 'pt-BR')).toBeNull(); // 3 casas: nunca arredonda
      expect(parseMoneyToCents('0', lang)).toBe(0);
    }
    expect(parseMoneyToCents('1.234,56', 'pt-BR')).toBe(123456);
    expect(parseMoneyToCents('1,234.56', 'en')).toBe(123456);
    expect(parseMoneyToCents('1,25', 'en')).toBe(125);
    expect(parseMoneyToCents('1.25', 'pt-BR')).toBe(125);
    expect(parseFloatInput('0,12345', 'pt-BR')).toBe(0.12345);
    expect(parseFloatInput('0.12345', 'en')).toBe(0.12345);
  });

  test('ida e volta: o texto de edição gerado no idioma é lido de volta igual', () => {
    for (const lang of ['en', 'pt-BR']) {
      for (const cents of [0, 1, 99, 100, 123456, 100000000]) {
        expect(parseMoneyToCents(formatCentsInput(cents, lang), lang)).toBe(cents);
      }
    }
  });
});

describe('notas de atualização: seleção por idioma com en como reserva', () => {
  const both = 'Intro\n<!-- pt-BR -->\nTexto pt\n<!-- en -->\nText en';
  test('as duas seções: cada idioma recebe a sua', () => {
    expect(selectReleaseNotes(both, 'pt-BR')).toBe('Intro\n\nTexto pt');
    expect(selectReleaseNotes(both, 'en')).toBe('Intro\n\nText en');
  });
  test('só pt-BR: en recebe tudo sem marcadores; só en: pt-BR recebe en', () => {
    expect(selectReleaseNotes('<!-- pt-BR -->\nTexto pt', 'en')).toBe('Texto pt');
    expect(selectReleaseNotes('<!-- en -->\nText en', 'pt-BR')).toBe('Text en');
  });
  test('idioma sem seção (es, ru) com en e pt-BR presentes: usa en, não o pt-BR', () => {
    expect(selectReleaseNotes(both, 'es')).toBe('Intro\n\nText en');
    expect(selectReleaseNotes(both, 'ru')).toBe('Intro\n\nText en');
  });
  test('sem nenhuma seção do idioma nem en (só pt-BR e es): mostra todas, sem marcadores', () => {
    expect(selectReleaseNotes('<!-- pt-BR -->\nA\n<!-- es -->\nB', 'ru')).toBe('A\n\nB');
  });
  test('sem marcadores: mostra tudo', () => {
    expect(selectReleaseNotes('Só texto', 'pt-BR')).toBe('Só texto');
    expect(selectReleaseNotes('', 'en')).toBe('');
  });
  test('marcadores com espaços, maiúsculas e CRLF', () => {
    const md = 'Intro\r\n  <!--   PT-br   -->  \r\nTexto pt\r\n<!--EN-->\r\nText en\r\n';
    expect(selectReleaseNotes(md, 'pt-BR')).toBe('Intro\n\nTexto pt');
    expect(selectReleaseNotes(md, 'en')).toBe('Intro\n\nText en');
  });
  test('seção do idioma vazia cai em en; seção en vazia cai em todas', () => {
    expect(selectReleaseNotes('<!-- pt-BR -->\n\n<!-- en -->\nText en', 'pt-BR')).toBe('Text en');
    expect(selectReleaseNotes('<!-- pt-BR -->\nA\n<!-- en -->\n', 'es')).toBe('A');
  });
  test('seções repetidas do mesmo idioma são concatenadas', () => {
    expect(selectReleaseNotes('<!-- en -->\nA\n<!-- pt-BR -->\nB\n<!-- en -->\nC', 'en')).toBe('A\n\nC');
  });
  test('marcador no meio de uma linha com texto não é marcador', () => {
    expect(selectReleaseNotes('texto <!-- en --> mais', 'pt-BR')).toBe('texto <!-- en --> mais');
  });
});
