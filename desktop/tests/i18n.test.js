'use strict';

const { translate, normalizeLanguage, MESSAGES } = require('../src/i18n');

describe('i18n dos diálogos', () => {
  test('pt-BR e en têm exatamente as mesmas chaves', () => {
    expect(Object.keys(MESSAGES.en).sort()).toEqual(Object.keys(MESSAGES['pt-BR']).sort());
  });

  test('traduz e interpola', () => {
    expect(translate('pt-BR', 'alreadyOpen.message', { port: 3001 })).toContain('http://localhost:3001');
    expect(translate('en', 'common.close')).toBe('Close');
    expect(translate('pt-BR', 'common.close')).toBe('Fechar');
  });

  test('idioma desconhecido ou ausente cai em pt-BR; chave desconhecida devolve a chave', () => {
    expect(normalizeLanguage('fr')).toBe('pt-BR');
    expect(normalizeLanguage(undefined)).toBe('pt-BR');
    expect(translate('fr', 'common.close')).toBe('Fechar');
    expect(translate('en', 'nao.existe')).toBe('nao.existe');
  });
});
