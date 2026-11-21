import { describe, expect, test } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { errorMessageFor } from './errorMessage';
import en from './en.json';
import ptBR from './pt-BR.json';
import { translate } from './translate';

const tPt = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
const tEn = (key: string, params?: Record<string, string | number>) => translate(en, key, params);

describe('T85: INVALID_RATE', () => {
  test('maxDecimals 6 (fração, enviado pelo backend) vira 4 casas do percentual', () => {
    const e = new ApiRequestError('INVALID_RATE', 'm', 400, { params: { maxDecimals: 6 } });
    expect(errorMessageFor(e, tPt, 'pt-BR')).toContain('no máximo 4 casas');
    expect(errorMessageFor(e, tEn, 'en')).toContain('at most 4 decimal');
  });
  test('sem params cai na mensagem genérica, sem placeholder', () => {
    const e = new ApiRequestError('INVALID_RATE', 'm', 400);
    expect(errorMessageFor(e, tPt, 'pt-BR')).toBe('Taxa inválida.');
    expect(errorMessageFor(e, tEn, 'en')).not.toMatch(/[{}]/);
  });
  test('maxDecimals menor que 2 não gera número negativo', () => {
    const e = new ApiRequestError('INVALID_RATE', 'm', 400, { params: { maxDecimals: 1 } });
    expect(errorMessageFor(e, tPt, 'pt-BR')).toContain('no máximo 0 casas');
  });
  test('chave roundedNote existe nos dois idiomas', () => {
    expect(tPt('storeForm.roundedNote')).not.toBe('storeForm.roundedNote');
    expect(tEn('storeForm.roundedNote')).not.toBe('storeForm.roundedNote');
  });
});

describe('T83: PAYLOAD_TOO_LARGE mostra o limite em MB', () => {
  test('maxBytes de 100 MB', () => {
    const e = new ApiRequestError('PAYLOAD_TOO_LARGE', 'm', 413, { params: { maxBytes: 100 * 1024 * 1024 } });
    expect(errorMessageFor(e, tPt, 'pt-BR')).toBe('O arquivo excede o limite de 100 MB.');
    expect(errorMessageFor(e, tEn, 'en')).toBe('The file exceeds the 100 MB limit.');
  });
  test('413 genérico (sem params) usa a mensagem comum', () => {
    const e = new ApiRequestError('PAYLOAD_TOO_LARGE', 'm', 413);
    expect(errorMessageFor(e, tPt, 'pt-BR')).toBe('Os dados enviados são grandes demais.');
  });
});
