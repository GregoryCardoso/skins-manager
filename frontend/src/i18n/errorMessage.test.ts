import { describe, expect, test } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { errorMessageFor } from './errorMessage';
import en from './en.json';
import ptBR from './pt-BR.json';
import { translate } from './translate';

const tPt = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
const tEn = (key: string, params?: Record<string, string | number>) => translate(en, key, params);
const err = (code: string, extra: { field?: string; params?: unknown } = {}) => new ApiRequestError(code, 'msg do backend', 400, extra);

describe('errorMessageFor com params', () => {
  test('ITEM_TRADE_LOCKED formata a data no idioma', () => {
    const e = err('ITEM_TRADE_LOCKED', { params: { tradeUnlockAt: '2026-11-25T15:30:00.000Z' } });
    expect(errorMessageFor(e, tPt, 'pt-BR')).toMatch(/^Item em trade lock até .*2026.*\.$/);
    expect(errorMessageFor(e, tEn, 'en')).toMatch(/^Item trade locked until .*25.*\.$/);
  });

  test('FLOAT_OUT_OF_RANGE formata a faixa', () => {
    const e = err('FLOAT_OUT_OF_RANGE', { params: { minFloat: 0.1, maxFloat: 0.7 } });
    expect(errorMessageFor(e, tPt, 'pt-BR')).toBe('O float deste item deve estar entre 0,1 e 0,7.');
    expect(errorMessageFor(e, tEn, 'en')).toBe("This item's float must be between 0.1 and 0.7.");
  });

  test('AGING_THRESHOLDS_ORDER usa os limites efetivos de params (D159)', () => {
    const e = err('AGING_THRESHOLDS_ORDER', { field: 'slowItemDays', params: { fastTurnoverDays: 25, slowItemDays: 21 } });
    expect(errorMessageFor(e, tPt)).toBe('O giro rápido (25 dias) deve ser menor que o limite de encalhado (21 dias).');
    expect(errorMessageFor(e, tEn)).toBe('Fast turnover (25 days) must be lower than the stuck limit (21 days).');
    expect(errorMessageFor(err('AGING_THRESHOLDS_ORDER'), tPt)).toBe('O giro rápido deve ser menor que o limite de encalhado. Corrija os valores.');
  });

  test('FIELD_TOO_LONG, INVALID_AMOUNT e UNKNOWN_FIELD', () => {
    expect(errorMessageFor(err('FIELD_TOO_LONG', { params: { maxLength: 200 } }), tPt)).toBe('Use no máximo 200 caracteres.');
    expect(errorMessageFor(err('INVALID_AMOUNT', { params: { maxCents: 1e10 } }), tPt, 'pt-BR')).toContain('100.000.000,00');
    expect(errorMessageFor(err('UNKNOWN_FIELD', { field: 'floatValue' }), tPt)).toBe('O app não reconhece o campo Float.');
    expect(errorMessageFor(err('UNKNOWN_FIELD', { field: 'foo' }), tPt)).toBe('O app não reconhece o campo foo.');
  });

  test('sem params o texto genérico do código; código sem tradução usa a mensagem do backend', () => {
    expect(errorMessageFor(err('FLOAT_OUT_OF_RANGE'), tPt)).toBe(tPt('errors.FLOAT_OUT_OF_RANGE'));
    expect(errorMessageFor(err('INVALID_AMOUNT'), tPt)).toBe(tPt('errors.INVALID_AMOUNT'));
    expect(errorMessageFor(err('CODIGO_NOVO'), tPt)).toBe('msg do backend');
    expect(errorMessageFor(new Error('x'), tPt)).toBe(tPt('errors.UNKNOWN'));
  });

  test('NET_RECEIVED_ABOVE_PRICE existe nos dois idiomas', () => {
    expect(errorMessageFor(err('NET_RECEIVED_ABOVE_PRICE'), tPt)).toContain('líquido');
    expect(errorMessageFor(err('NET_RECEIVED_ABOVE_PRICE'), tEn)).toContain('net');
  });
});
