'use strict';

// QA 11.1 (D369): idioma dos diálogos do desktop a partir do locale do sistema.
const { languageFromLocale, translate, normalizeLanguage, MESSAGES } = require('../src/i18n');

describe('languageFromLocale (QA 11.1)', () => {
  test.each([
    ['pt', 'pt-BR'], ['pt-PT', 'pt-BR'], ['pt-BR', 'pt-BR'], ['PT-br', 'pt-BR'], ['pt_BR.UTF-8', 'pt-BR'], [' pt-BR ', 'pt-BR'],
    ['en-GB', 'en'], ['en-US', 'en'], ['EN', 'en'],
    ['es-ES', 'en'], ['zh-CN', 'en'], ['C', 'en'], ['POSIX', 'en'], ['', 'en'], ['   ', 'en'], ['---', 'en'],
  ])('%j -> %s', (locale, expected) => {
    expect(languageFromLocale(locale)).toBe(expected);
  });

  test.each([[null], [undefined], [5], [{}], [[]]])('valor não string %j -> en, sem lançar', (value) => {
    expect(languageFromLocale(value)).toBe('en');
  });

  test('idioma desconhecido ou chave herdada do protótipo nunca quebra a tradução', () => {
    expect(normalizeLanguage('__proto__')).toBe('en');
    expect(normalizeLanguage('constructor')).toBe('en');
    expect(translate('es', 'common.close')).toBe(MESSAGES.en['common.close']);
    // Chave com nome de propriedade do protótipo: devolve a própria chave, sem lançar.
    expect(translate('pt-BR', 'constructor')).toBe('constructor');
    expect(translate('en', 'toString')).toBe('toString');
  });
});
