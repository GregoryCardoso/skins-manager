import { describe, expect, test } from 'vitest';
import { BASE_LANGUAGE, LANGUAGES, LANGUAGE_REGISTRY, detectLanguage, intlLocaleOf, isLanguage, languageInfo, matchLanguage } from './languages';

// Os 13 idiomas previstos (D369, R1): o registro só pode conter códigos desta lista.
const PLANNED = ['en', 'pt-BR', 'es', 'ru', 'tr', 'fr', 'it', 'zh-CN', 'de', 'pl', 'uk', 'ja', 'ko'];

describe('registro de idiomas (D369, 11.1)', () => {
  test('na 11.1 só en e pt-BR estão disponíveis, com o inglês como base e primeiro da lista', () => {
    expect([...LANGUAGES]).toEqual(['en', 'pt-BR']);
    expect(BASE_LANGUAGE).toBe('en');
    expect(LANGUAGE_REGISTRY[0].code).toBe(BASE_LANGUAGE);
  });

  test('cada entrada tem código único e previsto, nome nativo, locale válido do Intl e pasta do catálogo', () => {
    const codes = LANGUAGE_REGISTRY.map((entry) => entry.code as string);
    expect(new Set(codes).size).toBe(codes.length);
    for (const entry of LANGUAGE_REGISTRY) {
      expect(PLANNED).toContain(entry.code);
      expect(entry.nativeName.trim()).not.toBe('');
      expect(Intl.getCanonicalLocales(entry.intlLocale)).toHaveLength(1);
      expect(entry.catalogFolder.trim()).not.toBe('');
    }
  });

  test('nomes nativos sem tradução: cada idioma escrito nele mesmo', () => {
    expect(languageInfo('en').nativeName).toBe('English');
    expect(languageInfo('pt-BR').nativeName).toBe('Português (Brasil)');
  });

  test('isLanguage e intlLocaleOf', () => {
    expect(isLanguage('en')).toBe(true);
    expect(isLanguage('pt-BR')).toBe(true);
    for (const bad of ['es', 'ES', 'pt-br', '', null, undefined, 5]) expect(isLanguage(bad)).toBe(false);
    expect(intlLocaleOf('pt-BR')).toBe('pt-BR');
    expect(intlLocaleOf('xx')).toBe('en');
  });
});

describe('matchLanguage / detectLanguage (idioma inicial de uma instalação nova)', () => {
  test('código exato, sem diferenciar maiúsculas e com "_"', () => {
    expect(detectLanguage(['pt-BR'])).toBe('pt-BR');
    expect(detectLanguage(['pt_br'])).toBe('pt-BR');
    expect(detectLanguage(['EN'])).toBe('en');
  });
  test('mesmo idioma de outra região', () => {
    expect(detectLanguage(['pt-PT'])).toBe('pt-BR');
    expect(detectLanguage(['pt'])).toBe('pt-BR');
    expect(detectLanguage(['en-GB'])).toBe('en');
  });
  test('respeita a ordem de preferência e ignora idioma indisponível', () => {
    expect(detectLanguage(['ru-RU', 'pt-BR', 'en'])).toBe('pt-BR');
    expect(detectLanguage(['ru-RU', 'en-US', 'pt-BR'])).toBe('en');
  });
  test('sem correspondência ou lista vazia: inglês', () => {
    expect(detectLanguage(['ru-RU'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
    expect(detectLanguage(['', '  ', 'xx'])).toBe('en');
  });
  test('com os 13 idiomas disponíveis: es-MX -> es, zh -> zh-CN, e o chinês tradicional nunca vira o simplificado', () => {
    expect(matchLanguage(['es-MX'], PLANNED, 'en')).toBe('es');
    expect(matchLanguage(['zh'], PLANNED, 'en')).toBe('zh-CN');
    expect(matchLanguage(['zh-CN'], PLANNED, 'en')).toBe('zh-CN');
    expect(matchLanguage(['zh-TW'], PLANNED, 'en')).toBe('en');
    expect(matchLanguage(['zh-Hant'], PLANNED, 'en')).toBe('en');
    expect(matchLanguage(['uk-UA'], PLANNED, 'en')).toBe('uk');
    expect(matchLanguage(['ko-KR', 'ja'], PLANNED, 'en')).toBe('ko');
  });
  test('a função é autossuficiente (serializável no script do head)', () => {
    const copy = new Function(`return (${matchLanguage.toString()})`)() as typeof matchLanguage;
    expect(copy(['pt-PT'], ['en', 'pt-BR'], 'en')).toBe('pt-BR');
    expect(copy(['ru'], ['en', 'pt-BR'], 'en')).toBe('en');
  });
});
