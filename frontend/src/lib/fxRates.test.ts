import { describe, expect, test } from 'vitest';
import { currencyChangeView } from './currencyChange';
import {
  FX_STALE_AFTER_DAYS, buildFxRows, currenciesToAutoRefresh, fxRateAgeDays, fxSourcesFor, isFxRateStale,
} from './fxRates';
import type { CurrencyChangePreview, FxRateEntry } from '@/types/api';

const NOW = new Date('2026-11-25T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const entry = (currency: string, extra: Partial<FxRateEntry> = {}): FxRateEntry => ({
  currency, rate: 1.5, source: 'AWESOMEAPI', refreshSource: 'AWESOMEAPI', quotedAt: daysAgo(0), updatedAt: daysAgo(0), ...extra,
});

describe('idade e cotação antiga', () => {
  test('dias inteiros desde a data; nulo sem data; nunca negativo', () => {
    expect(fxRateAgeDays(daysAgo(0), NOW)).toBe(0);
    expect(fxRateAgeDays(daysAgo(5), NOW)).toBe(5);
    expect(fxRateAgeDays(null, NOW)).toBeNull();
    expect(fxRateAgeDays('lixo', NOW)).toBeNull();
    expect(fxRateAgeDays(new Date(NOW.getTime() + 86_400_000).toISOString(), NOW)).toBe(0);
  });

  test('antiga = fonte automática com data na fonte além de 3 dias', () => {
    expect(FX_STALE_AFTER_DAYS).toBe(3);
    expect(isFxRateStale(entry('UAH', { quotedAt: daysAgo(3) }), NOW)).toBe(false);
    expect(isFxRateStale(entry('UAH', { quotedAt: daysAgo(4) }), NOW)).toBe(true);
    expect(isFxRateStale(entry('KZT', { source: 'PTAX', quotedAt: daysAgo(10) }), NOW)).toBe(true);
  });

  test('a digitada à mão, a sem data e a ausente nunca são "antigas"', () => {
    expect(isFxRateStale(entry('BRL', { source: 'MANUAL', quotedAt: null }), NOW)).toBe(false);
    expect(isFxRateStale(entry('BRL', { source: 'MANUAL', quotedAt: daysAgo(90) }), NOW)).toBe(false);
    expect(isFxRateStale(entry('BRL', { source: null, quotedAt: daysAgo(90) }), NOW)).toBe(false);
    expect(isFxRateStale(entry('BRL', { quotedAt: null }), NOW)).toBe(false);
    expect(isFxRateStale(null, NOW)).toBe(false);
  });
});

describe('linhas da tela de cotações', () => {
  test('uma linha por moeda necessária, a de conversão primeiro e as outras em ordem alfabética', () => {
    const rows = buildFxRows(['BRL', 'EUR', 'GBP'], [entry('BRL'), entry('EUR'), entry('GBP')], 'GBP', NOW);
    expect(rows.map((r) => r.currency)).toEqual(['GBP', 'BRL', 'EUR']);
    expect(rows.map((r) => r.isDisplay)).toEqual([true, false, false]);
  });

  test('moeda sem cotação gravada ainda aparece (valor nulo) e USD nunca aparece', () => {
    const rows = buildFxRows(['USD', 'JPY'], [], 'USD', NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ currency: 'JPY', entry: null, rate: null, stale: false, ageDays: null, isDisplay: false });
  });

  test('só mostra as moedas de requiredFxCurrencies, mesmo havendo outras cotações gravadas', () => {
    const rows = buildFxRows(['BRL'], [entry('BRL'), entry('EUR')], 'BRL', NOW);
    expect(rows.map((r) => r.currency)).toEqual(['BRL']);
  });

  test('sem moedas necessárias (tudo em US$), nenhuma linha', () => {
    expect(buildFxRows([], [entry('BRL')], 'USD', NOW)).toEqual([]);
  });

  test('UAH, KZT e CNY com data de dias atrás ficam marcadas como antigas, com a idade', () => {
    const rows = buildFxRows(
      ['UAH', 'KZT', 'CNY', 'EUR'],
      [entry('UAH', { quotedAt: daysAgo(6) }), entry('KZT', { quotedAt: daysAgo(4) }), entry('CNY', { quotedAt: daysAgo(2) }), entry('EUR')],
      'EUR',
      NOW,
    );
    const byCurrency = Object.fromEntries(rows.map((r) => [r.currency, r]));
    expect(byCurrency.UAH).toMatchObject({ stale: true, ageDays: 6 });
    expect(byCurrency.KZT).toMatchObject({ stale: true, ageDays: 4 });
    expect(byCurrency.CNY).toMatchObject({ stale: false, ageDays: 2 });
    expect(byCurrency.EUR.stale).toBe(false);
  });

  test('a PTAX só aparece como fonte no BRL', () => {
    expect(fxSourcesFor('BRL')).toEqual(['AWESOMEAPI', 'PTAX']);
    for (const code of ['EUR', 'JPY', 'KRW', 'CLP', 'UAH']) expect(fxSourcesFor(code)).toEqual(['AWESOMEAPI']);
    const rows = buildFxRows(['BRL', 'EUR'], [], 'BRL', NOW);
    expect(rows.find((r) => r.currency === 'BRL')?.sources).toEqual(['AWESOMEAPI', 'PTAX']);
    expect(rows.find((r) => r.currency === 'EUR')?.sources).toEqual(['AWESOMEAPI']);
  });
});

describe('atualização ao abrir o app percorre todas as moedas necessárias', () => {
  test('inclui as de fonte automática e as sem cotação, em ordem estável', () => {
    expect(currenciesToAutoRefresh(['EUR', 'BRL', 'JPY'], [entry('BRL'), entry('EUR')])).toEqual(['BRL', 'EUR', 'JPY']);
  });

  test('nunca sobrescreve a digitada à mão (MANUAL), só essa é pulada', () => {
    const rates = [entry('BRL', { source: 'MANUAL', quotedAt: null }), entry('EUR')];
    expect(currenciesToAutoRefresh(['BRL', 'EUR', 'GBP'], rates)).toEqual(['EUR', 'GBP']);
  });

  test('tudo digitado à mão ou só US$: lista vazia, nenhuma chamada', () => {
    expect(currenciesToAutoRefresh(['BRL'], [entry('BRL', { source: 'MANUAL' })])).toEqual([]);
    expect(currenciesToAutoRefresh(['USD'], [])).toEqual([]);
    expect(currenciesToAutoRefresh([], [])).toEqual([]);
  });

  test('sem repetição', () => {
    expect(currenciesToAutoRefresh(['EUR', 'EUR'], [])).toEqual(['EUR']);
  });
});

describe('modal da troca de moeda (currencyChangeView)', () => {
  const preview = (extra: Partial<CurrencyChangePreview> = {}): CurrencyChangePreview => ({
    currency: 'EUR', steamStore: null, fxRateAvailable: true, automaticSource: true, ...extra,
  });

  test('com cotação: só o aviso aprovado, sem linha de cotação', () => {
    expect(currencyChangeView(preview(), 'EUR')).toMatchObject({ toBase: false, noRate: 'NONE', fetchRateAfter: false });
  });

  test('sem cotação e com fonte automática: avisa que vai buscar e busca depois de gravar', () => {
    expect(currencyChangeView(preview({ fxRateAvailable: false }), 'EUR')).toMatchObject({ noRate: 'AUTO', fetchRateAfter: true });
  });

  test('sem cotação e sem fonte automática: manda informar em Configurações, sem buscar', () => {
    expect(currencyChangeView(preview({ fxRateAvailable: false, automaticSource: false }), 'EUR')).toMatchObject({ noRate: 'MANUAL', fetchRateAfter: false });
  });

  test('USD: texto próprio (sem conversão) e nunca aviso de cotação', () => {
    expect(currencyChangeView(preview({ currency: 'USD', fxRateAvailable: true, automaticSource: false }), 'USD')).toMatchObject({
      toBase: true, noRate: 'NONE', fetchRateAfter: false,
    });
    expect(currencyChangeView(preview({ currency: 'USD', fxRateAvailable: false }), 'USD').noRate).toBe('NONE');
  });

  test('antes de a prévia chegar não há aviso de cotação', () => {
    expect(currencyChangeView(null, 'EUR')).toMatchObject({ noRate: 'NONE', fetchRateAfter: false });
  });

  test('na 11.3 a loja Steam sempre fica como está: KEEP e nenhuma linha, mesmo com loja Steam na prévia', () => {
    const steam = { id: 2, name: 'Steam', currency: 'BRL', hasEntries: true };
    for (const hasEntries of [true, false]) {
      const view = currencyChangeView(preview({ steamStore: { ...steam, hasEntries } }), 'EUR');
      expect(view.steamStore).toBe('KEEP');
      expect(view.steamLines).toEqual([]);
    }
  });
});
