import { describe, expect, test } from 'vitest';
import { CURRENCIES, ZERO_DECIMAL_CURRENCIES, hasNoDecimals, moneyInputMode } from './currencies';
import { currencyChangeView, initialSteamChecks, steamChoiceFor } from './currencyChange';
import { depositStoreOptions } from './depositForm';
import { formatCentsInput, parseMoneyToCents } from './numberInput';
import { makeStore } from './testFixtures';
import { withdrawalStoreOptions } from './withdrawalForm';
import type { CurrencyChangePreview, Deposit } from '@/types/api';

// QA 11.4: parse/format por moeda e idioma, a visão do modal da troca da moeda (Steam), escolha enviada ao backend e listas de lojas.
const LOCALES = ['en', 'pt-BR', 'de', 'fr', 'es', 'ru', 'ja', 'ko', 'zh-CN'];
const TWO_DECIMALS = CURRENCIES.filter((code) => !hasNoDecimals(code));

describe('parseMoneyToCents e formatCentsInput por moeda e idioma', () => {
  test('as moedas sem casas são exatamente as 9 da lista (11.11)', () => {
    expect([...ZERO_DECIMAL_CURRENCIES].sort()).toEqual(['CLP', 'COP', 'CRC', 'HUF', 'IDR', 'JPY', 'KRW', 'TWD', 'VND']);
    expect(CURRENCIES).toHaveLength(42);
  });

  test.each(ZERO_DECIMAL_CURRENCIES.flatMap((currency) => LOCALES.map((locale) => [currency, locale] as const)))(
    '%s em %s: ida e volta de valores inteiros (centavos múltiplos de 100)', (currency, locale) => {
      for (const cents of [100, 9900, 15000, 123400, 100000000]) {
        const text = formatCentsInput(cents, locale, currency);
        expect(text).toMatch(/^\d+$/);
        expect(parseMoneyToCents(text, locale, currency)).toBe(cents);
      }
    }
  );

  test.each(TWO_DECIMALS.flatMap((currency) => ['en', 'pt-BR', 'de', 'ru'].map((locale) => [currency, locale] as const)))(
    '%s em %s: 1 centavo, 99, 100, 150 e valores grandes fazem ida e volta com 2 casas', (currency, locale) => {
      for (const cents of [1, 99, 100, 150, 12345, 99999999]) {
        const text = formatCentsInput(cents, locale, currency);
        expect(text).toMatch(/^\d+[.,]\d{2}$/);
        expect(parseMoneyToCents(text, locale, currency)).toBe(cents);
      }
    }
  );

  test('o mesmo texto vale pelo separador do idioma: "1,5" em en e "1.5" em pt-BR são aceitos como alternativa', () => {
    expect(parseMoneyToCents('1,5', 'en', 'EUR')).toBe(150);
    expect(parseMoneyToCents('1.5', 'pt-BR', 'EUR')).toBe(150);
    expect(parseMoneyToCents('1.234,50', 'de', 'EUR')).toBe(123450);
    expect(parseMoneyToCents('1,234.50', 'en', 'GBP')).toBe(123450);
  });

  test.each(['JPY', 'KRW', 'CLP'])('%s: entradas hostis nunca viram dinheiro (nem arredondam em silêncio)', (currency) => {
    const hostile = ['1e3', '0x10', '１２', '+5', '-5', '12.', '.5', '1.0', '1,0', '12.50', '1_000', '', '   ', 'abc', '9007199254740993', '99999999999999999999', '١٢'];
    for (const text of hostile) expect(parseMoneyToCents(text, 'en', currency), text).toBeNull();
    expect(parseMoneyToCents(' 12 ', 'en', currency)).toBe(1200); // espaços nas pontas são aparados
    expect(parseMoneyToCents('0', 'en', currency)).toBe(0);
    expect(parseMoneyToCents('007', 'pt-BR', currency)).toBe(700);
  });

  test.each(['USD', 'EUR', 'BRL'])('%s: três casas, negativo, vazio e lixo -> null', (currency) => {
    for (const text of ['1.234', '1,234', '-1', '1.', '.5', '1e2', 'abc', '', ' ', '1..2', '1.2.3']) {
      // "1,234" em en é milhar válido?  Não: sem ponto o parser troca a vírgula por ponto e vira 3 casas
      expect(parseMoneyToCents(text, 'en', currency), text).toBeNull();
    }
    expect(parseMoneyToCents('0,01', 'pt-BR', currency)).toBe(1);
    expect(parseMoneyToCents('0', 'pt-BR', currency)).toBe(0);
  });

  test('sem moeda informada o comportamento é o antigo (2 casas)', () => {
    expect(parseMoneyToCents('1500', 'en')).toBe(150000);
    expect(parseMoneyToCents('15.5', 'en')).toBe(1550);
    expect(formatCentsInput(150000, 'en')).toBe('1500.00');
  });

  test('o teclado numérico só nas moedas sem casas', () => {
    for (const code of CURRENCIES) expect(moneyInputMode(code)).toBe(hasNoDecimals(code) ? 'numeric' : 'decimal');
  });
});

describe('currencyChangeView (modal da troca da moeda de conversão)', () => {
  const preview = (steamStore: CurrencyChangePreview['steamStore'], overrides: Partial<CurrencyChangePreview> = {}): CurrencyChangePreview => ({
    currency: 'EUR', steamStore, fxRateAvailable: true, automaticSource: true, ...overrides,
  });
  const steam = (currency: string, hasEntries: boolean) => ({ id: 2, name: 'Steam', currency, hasEntries });

  test('Steam sem lançamentos em outra moeda: uma linha FOLLOW, marcada por padrão', () => {
    const view = currencyChangeView(preview(steam('USD', false)), 'EUR');
    expect(view.steamLines).toEqual([{ kind: 'FOLLOW', checkable: true, defaultChecked: true }]);
    expect(view.steamCurrency).toBe('USD');
    expect(initialSteamChecks(view)).toEqual({ FOLLOW: true });
    expect(steamChoiceFor(view, initialSteamChecks(view))).toBe('FOLLOW');
    expect(steamChoiceFor(view, { FOLLOW: false })).toBe('KEEP');
    expect(steamChoiceFor(view, {})).toBe('KEEP');
  });

  test('Steam com lançamentos: texto fixo (sem caixa) + NEW_STORE desmarcada; só marcando vira NEW_STORE', () => {
    const view = currencyChangeView(preview(steam('BRL', true)), 'EUR');
    expect(view.steamLines).toEqual([
      { kind: 'LOCKED_INFO', checkable: false, defaultChecked: false },
      { kind: 'NEW_STORE', checkable: true, defaultChecked: false },
    ]);
    expect(view.steamCurrency).toBe('BRL');
    expect(initialSteamChecks(view)).toEqual({ NEW_STORE: false });
    expect(steamChoiceFor(view, initialSteamChecks(view))).toBe('KEEP');
    expect(steamChoiceFor(view, { NEW_STORE: true })).toBe('NEW_STORE');
    // o texto fixo nunca produz escolha, mesmo que alguém mande a chave
    expect(steamChoiceFor(view, { LOCKED_INFO: true })).toBe('KEEP');
    expect(steamChoiceFor(view, { FOLLOW: true })).toBe('KEEP'); // FOLLOW não existe nesta visão
  });

  test('aviso das taxas da Steam (M1/M2): vem pronto do backend (feesWillReset) e vale para FOLLOW e para NEW_STORE', () => {
    const reset = (extra: object = {}) => ({ ...steam('USD', false), hasFixedFees: true, feesWillReset: true, missingRateCurrency: 'EUR', ...extra });
    // FOLLOW (Steam sem lançamentos)
    const follow = currencyChangeView(preview(reset()), 'EUR');
    expect(follow.steamFeesZeroed).toBe(true);
    expect(follow.steamFeesMissingCurrency).toBe('EUR');
    // NEW_STORE (Steam com lançamentos) também zera as taxas da loja nova
    const newStore = currencyChangeView(preview(reset({ hasEntries: true, currency: 'BRL' })), 'EUR');
    expect(newStore.steamLines.map((l) => l.kind)).toEqual(['LOCKED_INFO', 'NEW_STORE']);
    expect(newStore.steamFeesZeroed).toBe(true);
    // a moeda sem cotação pode ser a de origem (a atual da Steam)
    expect(currencyChangeView(preview(reset({ missingRateCurrency: 'USD' })), 'EUR').steamFeesMissingCurrency).toBe('USD');
    // o backend decidiu que converte: sem aviso
    expect(currencyChangeView(preview({ ...reset(), feesWillReset: false, missingRateCurrency: null }), 'EUR').steamFeesZeroed).toBe(false);
    // campo ausente (backend antigo) = sem aviso
    expect(currencyChangeView(preview({ ...steam('USD', false), hasFixedFees: true }), 'EUR').steamFeesZeroed).toBe(false);
    // Steam já na moeda nova (sem linhas), sem preview ou sem loja Steam
    expect(currencyChangeView(preview(reset({ currency: 'EUR' })), 'EUR').steamFeesZeroed).toBe(false);
    expect(currencyChangeView(null, 'EUR').steamFeesZeroed).toBe(false);
    expect(currencyChangeView(preview(null, { fxRateAvailable: false }), 'EUR').steamFeesZeroed).toBe(false);
    expect(currencyChangeView(preview(null), 'EUR').steamFeesMissingCurrency).toBeNull();
  });

  test('Steam inativa (o preview não distingue): segue a mesma regra de lançamentos', () => {
    expect(currencyChangeView(preview(steam('BRL', false)), 'EUR').steamLines.map((l) => l.kind)).toEqual(['FOLLOW']);
    expect(currencyChangeView(preview(steam('BRL', true)), 'EUR').steamLines.map((l) => l.kind)).toEqual(['LOCKED_INFO', 'NEW_STORE']);
  });

  test('Steam já na moeda nova, sem Steam e sem prévia: nenhuma linha e nenhuma moeda', () => {
    for (const p of [preview(steam('EUR', false)), preview(steam('EUR', true)), preview(null), null]) {
      const view = currencyChangeView(p, 'EUR');
      expect(view.steamLines).toEqual([]);
      expect(view.steamCurrency).toBeNull();
      expect(steamChoiceFor(view, { FOLLOW: true, NEW_STORE: true })).toBe('KEEP');
    }
  });

  test('a moeda nova é USD: FOLLOW/NEW_STORE continuam valendo quando a Steam está em outra moeda', () => {
    const view = currencyChangeView(preview(steam('BRL', false), { currency: 'USD' }), 'USD');
    expect(view.toBase).toBe(true);
    expect(view.noRate).toBe('NONE');
    expect(view.steamLines.map((l) => l.kind)).toEqual(['FOLLOW']);
  });

  test('cotação ausente: o aviso depende da fonte automática e só busca depois quando há fonte', () => {
    expect(currencyChangeView(preview(null, { fxRateAvailable: false, automaticSource: true }), 'EUR')).toMatchObject({ noRate: 'AUTO', fetchRateAfter: true });
    expect(currencyChangeView(preview(null, { fxRateAvailable: false, automaticSource: false }), 'KZT')).toMatchObject({ noRate: 'MANUAL', fetchRateAfter: false });
    expect(currencyChangeView(preview(null, { fxRateAvailable: true }), 'EUR')).toMatchObject({ noRate: 'NONE', fetchRateAfter: false });
  });
});

describe('listas de lojas dos formulários de saque e aporte', () => {
  const stores = [
    makeStore({ id: 1, name: 'CSFloat', allowsWithdrawal: true }),
    makeStore({ id: 2, name: 'Steam', currency: 'EUR', allowsWithdrawal: true }),
    makeStore({ id: 3, name: 'Steam (BRL)', currency: 'BRL', isActive: false, allowsWithdrawal: true }),
    makeStore({ id: 4, name: 'Sem saque', currency: 'JPY' }),
    makeStore({ id: 5, name: 'Loja JPY', currency: 'JPY', allowsWithdrawal: true }),
  ];

  test('saque novo: só lojas ativas que permitem saque, de qualquer moeda; a antiga inativa não aparece', () => {
    expect(withdrawalStoreOptions(stores, null).map((s) => s.name)).toEqual(['CSFloat', 'Steam', 'Loja JPY']);
  });

  test('saque em edição: a loja gravada continua na lista, mesmo inativa', () => {
    expect(withdrawalStoreOptions(stores, 3).map((s) => s.name)).toEqual(['CSFloat', 'Steam', 'Steam (BRL)', 'Loja JPY']);
  });

  test('aporte novo: só lojas ativas em USD (Steam em EUR/BRL e a antiga inativa ficam de fora)', () => {
    expect(depositStoreOptions(stores, null).map((s) => s.name)).toEqual(['CSFloat']);
  });

  test('aporte em edição: a loja gravada USD volta à lista mesmo inativa; loja não USD nunca', () => {
    const inactiveUsd = makeStore({ id: 9, name: 'Velha', isActive: false });
    const deposit = { storeId: 9 } as Deposit;
    expect(depositStoreOptions([...stores, inactiveUsd], deposit).map((s) => s.name)).toEqual(['CSFloat', 'Velha']);
    expect(depositStoreOptions(stores, { storeId: 3 } as Deposit).map((s) => s.name)).toEqual(['CSFloat']);
  });
});
