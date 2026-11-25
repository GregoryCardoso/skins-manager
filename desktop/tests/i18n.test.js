'use strict';

const fs = require('fs');
const path = require('path');
const { translate, normalizeLanguage, languageFromLocale, MESSAGES, LANGUAGES, DEFAULT_LANGUAGE } = require('../src/i18n');

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n dos diálogos (D369: inglês é a base)', () => {
  test('o idioma base é o inglês e os idiomas disponíveis hoje são en e pt-BR', () => {
    expect(DEFAULT_LANGUAGE).toBe('en');
    expect([...LANGUAGES].sort()).toEqual(['en', 'pt-BR']);
  });

  test.each(LANGUAGES.filter((code) => code !== 'en'))('%s tem as mesmas chaves, os mesmos marcadores e nenhum texto vazio do inglês', (code) => {
    expect(Object.keys(MESSAGES[code]).sort()).toEqual(Object.keys(MESSAGES.en).sort());
    for (const [key, text] of Object.entries(MESSAGES[code])) {
      expect([`${code}.${key}`, text.trim() === '']).toEqual([`${code}.${key}`, false]);
      expect([`${code}.${key}`, placeholders(text)]).toEqual([`${code}.${key}`, placeholders(MESSAGES.en[key])]);
    }
  });

  test('o inglês não tem texto vazio', () => {
    for (const [key, text] of Object.entries(MESSAGES.en)) expect([key, text.trim() === '']).toEqual([key, false]);
  });

  test('toda chave usada nos diálogos existe no inglês', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'dialogs.js'), 'utf8');
    const used = new Set([...source.matchAll(/'([a-zA-Z]+\.[a-zA-Z]+)'/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(10);
    expect([...used].filter((key) => !(key in MESSAGES.en))).toEqual([]);
  });

  test('traduz e interpola', () => {
    expect(translate('pt-BR', 'alreadyOpen.message', { port: 3001 })).toContain('http://localhost:3001');
    expect(translate('en', 'common.close')).toBe('Close');
    expect(translate('pt-BR', 'common.close')).toBe('Fechar');
  });

  test('idioma desconhecido ou ausente cai no inglês; chave desconhecida devolve a chave', () => {
    expect(normalizeLanguage('fr')).toBe('en');
    expect(normalizeLanguage(undefined)).toBe('en');
    expect(translate('xx', 'common.close')).toBe('Close');
    expect(translate(undefined, 'common.close')).toBe('Close');
    expect(translate('en', 'nao.existe')).toBe('nao.existe');
  });

  test('languageFromLocale: idioma do sistema entre os disponíveis; senão, inglês', () => {
    expect(languageFromLocale('pt-BR')).toBe('pt-BR');
    expect(languageFromLocale('pt_BR')).toBe('pt-BR');
    expect(languageFromLocale('pt-PT')).toBe('pt-BR');
    expect(languageFromLocale('pt')).toBe('pt-BR');
    expect(languageFromLocale('en-US')).toBe('en');
    expect(languageFromLocale('en')).toBe('en');
    expect(languageFromLocale('ru')).toBe('en');
    expect(languageFromLocale('')).toBe('en');
    expect(languageFromLocale(undefined)).toBe('en');
  });
});

describe('textos da parada D (11.6)', () => {
  test('nenhum texto dos diálogos fala em servidor interno nem em "Open logs" sem explicação', () => {
    for (const code of LANGUAGES) {
      for (const [key, text] of Object.entries(MESSAGES[code])) {
        expect([`${code}.${key}`, /servidor interno|internal server|backend/i.test(text)]).toEqual([`${code}.${key}`, false]);
      }
    }
  });

  test('a porta só aparece em noPort.message, entre parênteses, nos dois idiomas', () => {
    for (const code of LANGUAGES) {
      expect(MESSAGES[code]['noPort.message']).toMatch(/\(3001 (a|to) 3010\)/);
      expect(MESSAGES[code]['noPort.title']).not.toMatch(/porta|port/i);
    }
  });

  test('crashLoop.detail mantém o marcador {dataDir} nos dois idiomas', () => {
    expect(translate('pt-BR', 'crashLoop.detail', { dataDir: 'D:/dados' })).toBe('Seus dados continuam salvos em D:/dados.');
    expect(translate('en', 'crashLoop.detail', { dataDir: 'D:/dados' })).toBe('Your data is still saved in D:/dados.');
  });
});
