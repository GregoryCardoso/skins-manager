import { describe, expect, test } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { API_ERROR_CODES } from './errorCodes';
import en from './en.json';
import { errorMessageFor } from './errorMessage';
import ptBR from './pt-BR.json';
import { translate } from './translate';

// QA 9.1: códigos novos de integração presentes em errorCodes.ts e nos dois idiomas; mensagem por código e sem vazar nada.
const CODES = [
  'INVALID_API_KEY_FORMAT', 'CSFLOAT_API_KEY_REQUIRED', 'CSFLOAT_AUTH_FAILED', 'IMPORT_SOURCE_UNREACHABLE', 'IMPORT_SOURCE_UNAVAILABLE',
  'IMPORT_RATE_LIMITED', 'IMPORT_SOURCE_FORMAT_CHANGED', 'IMPORT_STORE_CURRENCY_NOT_ALLOWED', 'CONFIRMATION_REQUIRED',
  'CSFLOAT_ACCOUNT_NOT_CHANGED',
];
const tPt = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
const tEn = (key: string, params?: Record<string, string | number>) => translate(en, key, params);
const err = (code: string, extra: { field?: string; params?: unknown } = {}, status = 502) => new ApiRequestError(code, 'mensagem do backend', status, extra);
const holders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('códigos de integração (D316)', () => {
  test.each(CODES)('%s está em errorCodes.ts e traduzido em pt-BR e en', (code) => {
    expect(API_ERROR_CODES as readonly string[]).toContain(code);
    for (const dict of [ptBR, en] as { errors: Record<string, string> }[]) {
      expect(typeof dict.errors[code]).toBe('string');
      expect(dict.errors[code].length).toBeGreaterThan(0);
    }
  });

  test.each(CODES)('%s: a mensagem traduzida substitui o texto do backend nos dois idiomas', (code) => {
    const e = err(code, { params: { source: 'CSFLOAT', retryAt: '2026-11-22T18:30:00.000Z' } });
    for (const [t, lang] of [[tPt, 'pt-BR'], [tEn, 'en']] as const) {
      const msg = errorMessageFor(e, t, lang);
      expect(msg).not.toBe('mensagem do backend');
      expect(msg).not.toMatch(/\{\w+\}/); // nenhum marcador sobrando
      expect(msg).not.toBe(t('errors.UNKNOWN'));
    }
  });

  test('CSFLOAT_ACCOUNT_CHANGED (9.2) ainda não é exigido: se existir, deve estar traduzido nos dois idiomas', () => {
    if ((API_ERROR_CODES as readonly string[]).includes('CSFLOAT_ACCOUNT_CHANGED')) {
      expect(typeof (ptBR.errors as Record<string, string>).CSFLOAT_ACCOUNT_CHANGED).toBe('string');
      expect(typeof (en.errors as Record<string, string>).CSFLOAT_ACCOUNT_CHANGED).toBe('string');
    }
  });

  test('os textos detalhados usam o nome da loja ("CSFloat"), nunca o código CSFLOAT', () => {
    for (const code of ['IMPORT_SOURCE_UNREACHABLE', 'IMPORT_SOURCE_UNAVAILABLE', 'IMPORT_SOURCE_FORMAT_CHANGED']) {
      const e = err(code, { params: { source: 'CSFLOAT' } });
      expect(errorMessageFor(e, tPt, 'pt-BR')).toContain('CSFloat');
      expect(errorMessageFor(e, tEn, 'en')).toContain('CSFloat');
      expect(errorMessageFor(e, tPt, 'pt-BR')).not.toContain('CSFLOAT');
    }
  });

  test('IMPORT_RATE_LIMITED com retryAt mostra a hora formatada; sem retryAt usa o texto genérico', () => {
    const withTime = errorMessageFor(err('IMPORT_RATE_LIMITED', { params: { source: 'CSFLOAT', retryAt: '2026-11-22T18:30:00.000Z' } }), tPt, 'pt-BR');
    expect(withTime).toContain('CSFloat');
    expect(withTime).toMatch(/2026|22/);
    expect(withTime).not.toContain('2026-11-22T18:30:00.000Z');
    const generic = errorMessageFor(err('IMPORT_RATE_LIMITED', { params: { source: 'CSFLOAT' } }), tPt, 'pt-BR');
    expect(generic).toBe(tPt('errors.IMPORT_RATE_LIMITED'));
    expect(generic).not.toMatch(/\{\w+\}/);
  });

  test('INVALID_API_KEY_FORMAT, CSFLOAT_API_KEY_REQUIRED e CSFLOAT_AUTH_FAILED têm texto próprio', () => {
    expect(errorMessageFor(err('INVALID_API_KEY_FORMAT', { field: 'apiKey' }, 400), tPt)).toContain('8 a 512');
    expect(errorMessageFor(err('CSFLOAT_API_KEY_REQUIRED', {}, 409), tEn, 'en')).toContain('Save the CSFloat key first');
    expect(errorMessageFor(err('CSFLOAT_AUTH_FAILED'), tPt)).toContain('recusou a chave');
  });

  test('os textos de erro de integração têm os mesmos {marcadores} em pt-BR e en', () => {
    for (const code of CODES) {
      const pt = (ptBR.errors as Record<string, string>)[code];
      const enText = (en.errors as Record<string, string>)[code];
      expect(holders(enText), code).toEqual(holders(pt));
      const ptDetail = (ptBR.errorDetails as Record<string, string>)[code];
      const enDetail = (en.errorDetails as Record<string, string>)[code];
      if (ptDetail !== undefined || enDetail !== undefined) {
        expect(typeof ptDetail, `${code} errorDetails pt-BR`).toBe('string');
        expect(typeof enDetail, `${code} errorDetails en`).toBe('string');
        expect(holders(enDetail), `${code} detail`).toEqual(holders(ptDetail));
      }
    }
  });

  test('a mensagem de erro nunca contém dado enviado pelo usuário que o ApiRequestError não recebeu', () => {
    const e = err('INVALID_API_KEY_FORMAT', { field: 'apiKey' }, 400);
    expect(errorMessageFor(e, tPt)).not.toMatch(/SENTINEL/);
  });
});
