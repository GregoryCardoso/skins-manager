// S4 (12.11): o comportamento do seletor, do modal e da tela de cotações está em CurrencySelect.test.tsx, CurrencyChangeModal.test.tsx e
// FxRateSettings.test.tsx (jsdom); aqui sobram só as varreduras de código-fonte.
// 11.3: seletor "Moeda de conversão", modal da troca, cotações por moeda e "≈" na moeda escolhida. Ligação pelo código-fonte (os
// componentes não rodam no ambiente node dos testes) e pelos textos; a lógica em si está em lib/currencies, lib/fxRates e lib/currencyChange.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { errorDetailParams } from '@/i18n/errorMessage';
import { translate } from '@/i18n/translate';
import { ApiRequestError, changeDisplayCurrency, getCurrencyChangePreview, refreshFxRate, updateFxRate } from '@/services/api';

const src = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(src, rel), 'utf8');

describe('seletor (menu e Configurações)', () => {
  test('o menu lateral (12.4) tem a moeda ao lado do idioma e as Configurações continuam com o CurrencySelect', () => {
    // O comportamento do menu (a moeda abre o modal sem gravar) é coberto em layout/NavPreferences.test.tsx.
    const prefsNav = read('components/layout/NavPreferences.tsx');
    expect(prefsNav).toMatch(/<NavCurrencyPicker /);
    expect(prefsNav.indexOf('setLanguage(')).toBeLessThan(prefsNav.indexOf('<NavCurrencyPicker'));
    const prefs = read('components/PreferencesSettings.tsx');
    expect(prefs).toMatch(/<CurrencySelect \/>/);
    expect(read('components/CurrencySelect.tsx')).toMatch(/currency\.label/);
    expect(prefs.indexOf('setLanguage(')).toBeLessThan(prefs.indexOf('<CurrencySelect'));
  });

  test('trocar o idioma nunca muda a moeda: setLanguage só envia o idioma', () => {
    const provider = read('components/PreferencesProvider.tsx');
    const setLanguage = provider.slice(provider.indexOf('const setLanguage'), provider.indexOf('// Troca otimista'));
    expect(setLanguage).toMatch(/save\(\{ language: next \}\)/);
    expect(setLanguage).not.toMatch(/[Cc]urrency/);
    expect(read('i18n/languages.ts')).not.toMatch(/DEFAULT_CURRENCY|defaultCurrency/);
  });
});

describe('modal da troca', () => {
  const modal = read('components/CurrencyChangeModal.tsx');

  test('11.4: as linhas da loja Steam vêm de view.steamLines; a opção de nova loja nasce desmarcada e só marcada envia NEW_STORE', () => {
    expect(modal).toMatch(/view\.steamLines\.map/);
    expect(modal).toMatch(/currency\.modal\.steamFollow/);
    expect(modal).toMatch(/currency\.modal\.steamNewStore/);
    expect(modal).toMatch(/currency\.modal\.steamLocked/);
    expect(modal).toMatch(/initialSteamChecks\(view\)/);
  });

  test('textos aprovados (E-P3-Q18 e Q19) em pt-BR e en', () => {
    expect(ptBR.currency.modal.title).toBe('Mostrar valores em {currency}?');
    expect(ptBR.currency.modal.body).toBe(
      'Os valores em {currency} são aproximados. Eles usam a cotação e mudam quando ela muda. Seu saldo e seu lucro continuam em dólar (US$).',
    );
    expect(ptBR.currency.modal.confirm).toBe('Usar {currency}');
    expect(en.currency.modal.title).toBe('Show values in {currency}?');
    expect(en.currency.modal.confirm).toBe('Use {currency}');
    for (const dict of [ptBR, en]) {
      expect(dict.currency.modal.body).toMatch(/US\$/);
      expect(dict.currency.modal.bodyBase).toMatch(/US\$/);
    }
  });

  test('os textos interpolam a moeda', () => {
    expect(translate(ptBR, 'currency.modal.title', { currency: 'euro (EUR)' })).toBe('Mostrar valores em euro (EUR)?');
    expect(translate(en, 'currency.modal.confirm', { currency: 'EUR' })).toBe('Use EUR');
  });
});

describe('"≈" na moeda escolhida: nenhum componente fixa BRL', () => {
  const FILES = [
    'components/MoneyWithApprox.tsx', 'components/ProfitEquation.tsx', 'components/ProfitInfoStrip.tsx', 'components/SalesTable.tsx', 'components/SaleCells.tsx', 'components/SalesSummary.tsx',
    'components/StoreBalancesPanel.tsx', 'components/InventoryGroupTable.tsx', 'components/MarketValueCell.tsx',
    'components/MarketValueCards.tsx', 'components/MoneyApprox.tsx', 'lib/marketValueDisplay.ts', 'lib/baseMoney.ts',
    'components/DepositsTable.tsx', 'components/WithdrawalsSection.tsx', 'components/WithdrawalsTable.tsx',
  ];

  test.each(FILES)('%s não formata nenhum "≈" com BRL fixo', (file) => {
    const code = read(file);
    expect(code).not.toMatch(/approx[A-Za-z]*[^;\n]*'BRL'/);
    expect(code).not.toMatch(/formatMoney\([^)]*approx[^)]*, 'BRL'/i);
  });

  test('os "≈" usam o approxCurrency da resposta', () => {
    expect(read('components/SalesSummary.tsx')).toMatch(/summary\.approxCurrency/);
    expect(read('components/SalesSummary.tsx')).toMatch(/approxCurrency=\{approxCurrency\}/);
    expect(read('lib/inventoryColumns.tsx')).toMatch(/group\.approxCurrency/);
    expect(read('components/MoneyWithApprox.tsx')).toMatch(/formatMoney\(approxCents, approxCurrency, locale\)/);
    expect(read('components/SalesTable.tsx')).toMatch(/approxCurrency=\{info\.approxCurrency\}/);
    expect(read('components/StoreBalancesPanel.tsx')).toMatch(/approxCurrency: data\?\.totals\.approxCurrency/);
    expect(read('components/ProfitEquation.tsx')).toMatch(/approxCurrency=\{data\.approxCurrency\}/);
    expect(read('components/MarketValueCell.tsx')).toMatch(/currency=\{view\.approxCurrency\}/);
    expect(read('components/MarketValueCards.tsx')).toMatch(/pnl\.approxCurrency/);
  });

  test('o texto "≈ {value}" é genérico nos dois idiomas (sem R$ nem moeda fixa)', () => {
    for (const dict of [ptBR, en]) {
      expect(dict.common.approx).toBe('≈ {value}');
    }
  });
});

describe('cotações: telas e atualização ao abrir', () => {
  test('textos novos nos dois idiomas', () => {
    for (const dict of [ptBR, en]) {
      for (const key of ['intro', 'noneNeeded', 'displayBadge', 'staleHint'] as const) expect(dict.settings.fx[key].length).toBeGreaterThan(0);
      expect(dict.settings.fx.autoFailed).toContain('{currency}');
      expect(dict.settings.fx.autoFailedWithRate).toContain('{currency}');
    }
  });
});

describe('FX_RATE_OUT_OF_RANGE (faixa manual)', () => {
  const error = (params: Record<string, unknown>) => new ApiRequestError('FX_RATE_OUT_OF_RANGE', 'x', 400, { params });

  test('o código está traduzido e a mensagem mostra a moeda e a faixa no formato do idioma', () => {
    const t = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
    const params = errorDetailParams(error({ currency: 'BRL', min: 0.5, max: 100 }), t, 'pt-BR');
    expect(params).toEqual({ currency: 'BRL', min: '0,5', max: '100' });
    expect(translate(ptBR, 'errors.FX_RATE_OUT_OF_RANGE', params ?? {})).toBe('Essa cotação parece errada. Para BRL, use um valor entre 0,5 e 100.');
    expect(translate(en, 'errors.FX_RATE_OUT_OF_RANGE', errorDetailParams(error({ currency: 'ARS', min: 5, max: 500000 }), (k) => k, 'en') ?? {})).toBe(
      'That rate looks wrong. For ARS, enter a value between 5 and 500,000.',
    );
  });

  test('sem os valores, devolve null (a mensagem genérica do código)', () => {
    expect(errorDetailParams(error({}), (k) => k, 'en')).toBeNull();
  });
});

describe('cliente da API (11.3)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (data: unknown = {}) => {
    const fn = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    vi.stubGlobal('fetch', fn);
    return fn;
  };
  const call = (fn: ReturnType<typeof vi.fn>) => {
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    return { url: new URL(url), init, body: init.body ? JSON.parse(init.body as string) : undefined };
  };

  test('changeDisplayCurrency: PATCH /settings com displayCurrency e steamStore KEEP (padrão)', async () => {
    const fn = stub({ settings: {}, steamStore: null });
    await changeDisplayCurrency('EUR');
    const { url, init, body } = call(fn);
    expect(url.pathname).toBe('/api/settings');
    expect(init.method).toBe('PATCH');
    expect(body).toEqual({ displayCurrency: 'EUR', steamStore: 'KEEP' });
  });

  test('getCurrencyChangePreview: GET com ?currency=', async () => {
    const fn = stub({ currency: 'JPY' });
    await getCurrencyChangePreview('JPY');
    const { url, init } = call(fn);
    expect(url.pathname).toBe('/api/settings/currency-change-preview');
    expect(url.searchParams.get('currency')).toBe('JPY');
    expect(init.method).toBe('GET');
  });

  test('updateFxRate envia { currency, rate }; refreshFxRate envia a moeda e a fonte', async () => {
    let fn = stub({});
    await updateFxRate('KRW', 1389.5);
    expect(call(fn).body).toEqual({ currency: 'KRW', rate: 1389.5 });
    fn = stub({ settings: {}, quote: null });
    await refreshFxRate({ currency: 'BRL', source: 'PTAX', trigger: 'AUTO' });
    expect(call(fn).body).toEqual({ currency: 'BRL', source: 'PTAX', trigger: 'AUTO' });
  });
});
