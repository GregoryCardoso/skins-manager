import { describe, expect, test } from 'vitest';
import { ApiRequestError } from '@/services/api';
import ptBR from './pt-BR.json';
import en from './en.json';
import { errorMessageFor } from './errorMessage';
import { translate } from './translate';

const t = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);

describe('translate', () => {
  test('chave aninhada', () => expect(t('nav.sales')).toBe('Vendas'));
  test('interpolação', () => expect(t('catalog.total', { total: 5 })).toBe('Total de itens: 5'));
  test('parâmetro ausente mantém {param}', () => expect(t('catalog.total')).toBe('Total de itens: {total}'));
  test('chave ausente devolve a chave', () => expect(t('nada.aqui')).toBe('nada.aqui'));
  test('chave que aponta para grupo devolve a chave', () => expect(t('nav')).toBe('nav'));
});

describe('errorMessageFor', () => {
  test('código conhecido', () => {
    expect(errorMessageFor(new ApiRequestError('NETWORK_ERROR', 'x'), t)).toBe(ptBR.errors.NETWORK_ERROR);
  });
  test('código desconhecido com mensagem', () => {
    expect(errorMessageFor(new ApiRequestError('NOVO', 'Mensagem do servidor', 400), t)).toBe('Mensagem do servidor');
  });
  test('código desconhecido sem mensagem', () => {
    expect(errorMessageFor(new ApiRequestError('NOVO', '  ', 400), t)).toBe(ptBR.errors.UNKNOWN);
  });
  test('código conhecido ignora a mensagem do servidor, nos dois idiomas', () => {
    const tEn = (key: string) => translate(en, key);
    const err = new ApiRequestError('CATALOG_REFRESH_IN_PROGRESS', 'texto do servidor', 409);
    expect(errorMessageFor(err, t)).toBe(ptBR.errors.CATALOG_REFRESH_IN_PROGRESS);
    expect(errorMessageFor(err, tEn)).toBe(en.errors.CATALOG_REFRESH_IN_PROGRESS);
  });
  test('valores que não são Error (string, null, undefined)', () => {
    for (const v of ['x', null, undefined, { code: 'NETWORK_ERROR' }]) {
      expect(errorMessageFor(v, t)).toBe(ptBR.errors.UNKNOWN);
    }
  });
  test('erro que não é da API', () => {
    expect(errorMessageFor(new Error('boom'), t)).toBe(ptBR.errors.UNKNOWN);
  });
});
