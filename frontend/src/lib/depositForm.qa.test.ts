import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  buildDepositCreateBody, buildDepositPatchBody, depositFormFromDeposit, validateDepositForm, type DepositFormState,
} from './depositForm';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { errorMessageFor } from '@/i18n/errorMessage';
import { translate } from '@/i18n/translate';
import { ApiRequestError } from '@/services/api';
import type { Deposit } from '@/types/api';

const deposit = (overrides: Partial<Deposit> = {}): Deposit => ({
  id: 1, storeId: 2, storeName: 'CSFloat', currency: 'USD', amountStoreCents: 12345, amountBrlCents: null,
  depositedAt: '2026-11-10T15:30:45.123Z', note: 'pix', legacy: false, amountUsdCents: 12345, approxBrlCents: null, estimated: false,
  createdAt: '2026-11-10T15:30:45.123Z', updatedAt: '2026-11-10T15:30:45.123Z', ...overrides,
});
const state = (overrides: Partial<DepositFormState> = {}): DepositFormState => ({
  storeId: 2, amountText: '100,50', paidText: '', depositedAt: '2026-11-10T12:30', note: '', ...overrides,
});
const cents = (text: string, language: string) => buildDepositCreateBody(state({ amountText: text }), language).amountStoreCents;
const valid = (text: string, language: string) => Object.keys(validateDepositForm(state({ amountText: text }), language)).length === 0;

describe('conversão do valor por idioma', () => {
  test.each([
    ['1.234,56', 'pt-BR', 123456],
    ['1234,56', 'pt-BR', 123456],
    ['1234.56', 'pt-BR', 123456], // sem vírgula: ponto é decimal
    ['1234', 'pt-BR', 123400],
    ['0,05', 'pt-BR', 5],
    ['1.000.000,5', 'pt-BR', 100000050],
    [' 1 234,56 ', 'pt-BR', 123456],
    ['1,234.56', 'en', 123456],
    ['1234.56', 'en', 123456],
    ['1234,56', 'en', 123456], // sem ponto: vírgula é decimal
    ['1,234,567.8', 'en', 123456780],
    ['.5', 'en', null], // sem dígito antes do ponto não é aceito
  ])('%s (%s) -> %s', (text, language, expected) => {
    if (expected === null) expect(valid(text, language)).toBe(false);
    else {
      expect(valid(text, language)).toBe(true);
      expect(cents(text, language)).toBe(expected);
    }
  });

  test.each([
    ['1,234', 'pt-BR'], // 3 casas: nunca arredonda em silêncio
    ['1.234', 'pt-BR'], // ambíguo (milhar?): recusado em vez de adivinhar
    ['1,234', 'en'],
    ['12,3,4', 'pt-BR'],
    ['1e3', 'pt-BR'],
    ['R$ 10', 'pt-BR'],
    ['10,5,', 'pt-BR'],
    ['--5', 'en'],
    ['-0,01', 'pt-BR'],
    ['0', 'en'],
    ['0,00', 'pt-BR'],
    ['Infinity', 'en'],
    ['NaN', 'pt-BR'],
    ['٣٫٥', 'pt-BR'],
    ['99999999999999999999', 'pt-BR'], // além do inteiro seguro em centavos
  ])('inválido: %s (%s)', (text, language) => {
    expect(valid(text, language)).toBe(false);
  });

  test('o idioma fora de pt-BR/en usa a regra do inglês, sem lançar', () => {
    expect(cents('1,234.56', 'es')).toBe(123456);
  });
});

describe('data local -> ISO', () => {
  test('o ISO enviado representa exatamente o horário digitado (instante local) e tem offset', () => {
    const body = buildDepositCreateBody(state({ depositedAt: '2026-11-10T23:59' }), 'pt-BR');
    expect(body.depositedAt).toMatch(/^2026-11-10T23:59:00[+-]\d{2}:\d{2}$/);
    expect(new Date(body.depositedAt).getTime()).toBe(new Date(2026, 10, 10, 23, 59, 0).getTime());
  });

  test('meia-noite local e virada de ano', () => {
    const midnight = buildDepositCreateBody(state({ depositedAt: '2026-01-01T00:00' }), 'pt-BR');
    expect(new Date(midnight.depositedAt).getTime()).toBe(new Date(2026, 0, 1, 0, 0, 0).getTime());
  });

  test.each(['2026-11-10', '2026-11-10T25:00', '2026-13-10T10:00', '2026-02-29T10:00', '10/11/2026 10:00', ' '])('data inválida %p', (text) => {
    expect(validateDepositForm(state({ depositedAt: text }), 'pt-BR').depositedAt).toBe('deposits.form.invalidDate');
  });
});

describe('PATCH com só o que mudou', () => {
  test('editar sem tocar em nada preserva segundos/milissegundos da data original (não envia a data)', () => {
    const original = deposit(); // 15:30:45.123Z
    expect(buildDepositPatchBody(depositFormFromDeposit(original, 'pt-BR'), original, 'pt-BR')).toEqual({});
  });

  test('o valor é comparado em centavos, não em texto ("123,45" = "123.45" = "123,450" inválido)', () => {
    const original = deposit();
    const base = depositFormFromDeposit(original, 'pt-BR');
    expect(buildDepositPatchBody({ ...base, amountText: '123.45' }, original, 'pt-BR')).toEqual({});
    expect(buildDepositPatchBody({ ...base, amountText: '1.234,50' }, original, 'pt-BR')).toEqual({ amountStoreCents: 123450 });
  });

  test('limpar a nota e o valor pago enviam null; trocar de loja e nota juntos; nota só com espaços em aporte sem nota = sem mudança', () => {
    const original = deposit({ amountBrlCents: 50000 });
    const base = depositFormFromDeposit(original, 'pt-BR');
    expect(buildDepositPatchBody({ ...base, paidText: '' }, original, 'pt-BR')).toEqual({ amountBrlCents: null });
    expect(buildDepositPatchBody({ ...base, note: '' }, original, 'pt-BR')).toEqual({ note: null });
    expect(buildDepositPatchBody({ ...base, storeId: 9, note: 'nova' }, original, 'pt-BR')).toEqual({ storeId: 9, note: 'nova' });
    const bare = deposit({ note: null });
    expect(buildDepositPatchBody({ ...depositFormFromDeposit(bare, 'pt-BR'), note: '   ' }, bare, 'pt-BR')).toEqual({});
  });

  test('trocar para outra loja envia só storeId (o valor creditado é mantido)', () => {
    const original = deposit();
    expect(buildDepositPatchBody({ ...depositFormFromDeposit(original, 'pt-BR'), storeId: 4 }, original, 'pt-BR')).toEqual({ storeId: 4 });
  });

  test('valor inválido no PATCH não vira campo (a validação local barra antes)', () => {
    const original = deposit();
    const base = depositFormFromDeposit(original, 'pt-BR');
    expect(buildDepositPatchBody({ ...base, amountText: 'abc' }, original, 'pt-BR')).toEqual({});
    expect(validateDepositForm({ ...base, amountText: 'abc' }, 'pt-BR')).toEqual({ amountStoreCents: 'deposits.form.invalidMoney' });
  });

  test('o formulário em en preenche "123.45" e volta ao mesmo valor', () => {
    const original = deposit();
    const form = depositFormFromDeposit(original, 'en');
    expect(form.amountText).toBe('123.45');
    expect(buildDepositPatchBody(form, original, 'en')).toEqual({});
  });
});

describe('textos: chaves usadas nos componentes e erros dos aportes', () => {
  const root = path.join(__dirname, '..');
  const files = ['components/DepositFormModal.tsx', 'components/DepositsTable.tsx', 'app/profit/page.tsx', 'components/AppHeader.tsx', 'lib/depositForm.ts'];
  const keys = new Set<string>();
  for (const file of files) {
    const source = readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/['"`]((?:deposits|profit|nav)\.[A-Za-z0-9_.]+)['"`]/g)) keys.add(match[1]);
  }

  test('há chaves para verificar', () => {
    expect(keys.size).toBeGreaterThan(15);
  });

  test.each(Array.from(keys))('a chave %s existe em pt-BR e en', (key) => {
    // chaves de plural (tPlural) existem como `<chave>.one` e `<chave>.other`
    const exists = (dict: unknown, k: string) => translate(dict, k) !== k || (translate(dict, `${k}.one`) !== `${k}.one` && translate(dict, `${k}.other`) !== `${k}.other`);
    expect(exists(ptBR, key), `pt-BR ${key}`).toBe(true);
    expect(exists(en, key), `en ${key}`).toBe(true);
  });

  test.each([
    ['INVALID_AMOUNT', { maxCents: 1e10 }],
    ['FIELD_TOO_LONG', { maxLength: 500 }],
    ['STORE_NOT_FOUND', undefined],
    ['INVALID_DATE', undefined],
    ['DEPOSITED_AT_IN_FUTURE', undefined],
    ['DEPOSIT_NOT_FOUND', undefined],
    ['DEPOSIT_STORE_CURRENCY_NOT_ALLOWED', undefined],
    ['STORE_REQUIRED', undefined],
    ['REQUIRED_FIELD', undefined],
    ['UNSUPPORTED_MEDIA_TYPE', undefined],
    ['FORBIDDEN_HOST', undefined],
  ])('o código %s tem mensagem traduzida nos dois idiomas, sem placeholder sobrando', (code, params) => {
    for (const [dict, locale] of [[ptBR, 'pt-BR'], [en, 'en']] as const) {
      const t = (key: string, p?: Record<string, string | number>) => translate(dict, key, p);
      const error = new ApiRequestError(code, 'm', 400, { field: 'amountStoreCents', params });
      const message = errorMessageFor(error, t, locale);
      expect(message.length, `${locale} ${code}`).toBeGreaterThan(5);
      expect(message, `${locale} ${code}`).not.toMatch(/\{\w+\}|^errors\./);
    }
  });

  test('menu: nav.profit é o rótulo de Lucro real / Real profit', () => {
    expect(translate(ptBR, 'nav.profit')).toMatch(/lucro/i);
    expect(translate(en, 'nav.profit')).toMatch(/profit/i);
  });
});
