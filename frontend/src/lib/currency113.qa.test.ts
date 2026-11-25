// QA 11.3: bordas de formatação, storeCounterpart, modal (lógica e ligação), cotações por moeda e paridade de textos.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { errorMessageFor } from '@/i18n/errorMessage';
import { translate } from '@/i18n/translate';
import { moneyTexts, storeCounterpart } from './baseMoney';
import { CURRENCIES, ZERO_DECIMAL_CURRENCIES, currencyOptions, hasNoDecimals } from './currencies';
import { currencyChangeView, steamChoiceFor } from './currencyChange';
import { formatApprox, formatMoney, formatRate } from './format';
import { FX_STALE_AFTER_DAYS, buildFxRows, currenciesToAutoRefresh, fxRateAgeDays, isFxRateStale } from './fxRates';
import { ApiRequestError } from '@/services/api';
import type { CurrencyChangePreview, FxRateEntry } from '@/types/api';

const src = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(src, rel), 'utf8');
const LOCALES = ['en', 'pt-BR'] as const;
const BAD = /NaN|undefined|null|Infinity/;

describe('formatMoney nas 17 moedas', () => {
  test.each(CURRENCIES.flatMap((c) => LOCALES.map((l) => [c, l] as const)))('%s em %s: zero, negativo e grande sem NaN/undefined', (currency, locale) => {
    for (const cents of [0, 1, 99, 12345, -12345, 9_999_999_999_999]) {
      const text = formatMoney(cents, currency, locale);
      expect(text).not.toMatch(BAD);
      expect(text).toMatch(/\d/);
    }
    const zero = formatMoney(0, currency, locale);
    if (hasNoDecimals(currency)) expect(zero).not.toMatch(/[.,]\d/);
    else expect(zero).toMatch(/[.,]00/);
  });

  test('JPY, KRW e CLP: sem casas e centavos arredondados à unidade', () => {
    expect(ZERO_DECIMAL_CURRENCIES).toEqual(['JPY', 'KRW', 'CLP']);
    expect(formatMoney(15123, 'JPY', 'en')).toBe('¥151');
    expect(formatMoney(15150, 'JPY', 'en')).toBe('¥152');
    expect(formatMoney(15149, 'JPY', 'en')).toBe('¥151');
    expect(formatMoney(138950, 'KRW', 'en')).toBe('₩1,390');
    expect(formatMoney(95000, 'CLP', 'en')).toContain('950');
    expect(formatMoney(95000, 'CLP', 'en')).not.toMatch(/\.\d{2}$/);
    expect(formatMoney(15123, 'JPY', 'pt-BR')).not.toMatch(/,\d/);
  });

  test('moedas com casas mostram 2 casas; o locale muda só os separadores', () => {
    expect(formatMoney(123456, 'USD', 'en')).toBe('$1,234.56');
    expect(formatMoney(123456, 'BRL', 'pt-BR').replace(/\s/g, ' ')).toBe('R$ 1.234,56');
    expect(formatMoney(123456, 'EUR', 'en')).toBe('€1,234.56');
    expect(formatMoney(-500, 'USD', 'en')).toBe('-$5.00');
    expect(formatMoney(-500, 'BRL', 'pt-BR')).toContain('-');
  });

  test('as 17 moedas nunca produzem "undefined"; código malformado lança RangeError', () => {
    for (const currency of CURRENCIES) expect(formatMoney(100, currency, 'en')).not.toMatch(/undefined/);
    expect(() => formatMoney(100, 'xx', 'en')).toThrow(RangeError);
  });

  test('formatApprox usa a moeda que veio', () => {
    expect(formatApprox({ currency: 'JPY', cents: 15123 }, 'en')).toBe('¥151');
    expect(formatApprox({ currency: 'EUR', cents: 100 }, 'en')).toBe('€1.00');
  });
});

describe('formatRate nas 17 moedas', () => {
  test.each(CURRENCIES.filter((c) => c !== 'USD').flatMap((c) => LOCALES.map((l) => [c, l] as const)))('%s em %s', (currency, locale) => {
    for (const rate of [0.5, 5.4, 5.4123, 151.23456, 1389.5, 40000]) {
      const text = formatRate(rate, locale, currency);
      expect(text).not.toMatch(BAD);
      expect(text).toMatch(/\d/);
    }
  });

  test('2 a 4 casas, inclusive em JPY/KRW/CLP (a cotação não é valor em centavos)', () => {
    expect(formatRate(5.4, 'pt-BR').replace(/\s/g, ' ')).toBe('R$ 5,40');
    expect(formatRate(5.41234, 'en', 'BRL')).toBe('R$5.4123');
    expect(formatRate(151.2, 'en', 'JPY')).toBe('¥151.20');
    expect(formatRate(1389.12345, 'en', 'KRW')).toBe('₩1,389.1235');
    expect(formatRate(950, 'en', 'CLP')).toContain('950.00');
  });

  test('sem moeda, BRL (padrão histórico); zero e número gigante não quebram', () => {
    expect(formatRate(5.4, 'en')).toBe('R$5.40');
    expect(formatRate(0, 'en', 'EUR')).toBe('€0.00');
    expect(formatRate(1e12, 'en', 'ARS')).not.toMatch(BAD);
  });
});

describe('moneyTexts: nada de NaN/undefined sem "≈"', () => {
  test('approxCents nulo/ausente ou approxCurrency ausente/nula/vazia: approx nulo', () => {
    const cases = [
      { cents: 100, approxCents: null, approxCurrency: 'EUR' },
      { cents: 100, approxCents: undefined, approxCurrency: 'EUR' },
      { cents: 100, approxCents: 500 },
      { cents: 100, approxCents: 500, approxCurrency: null },
      { cents: 100, approxCents: 500, approxCurrency: undefined },
      { cents: 100, approxCents: 500, approxCurrency: '' },
      { cents: 100 },
    ];
    for (const input of cases) {
      const texts = moneyTexts(input, 'en');
      expect(texts.approx).toBeNull();
      expect(JSON.stringify(texts)).not.toMatch(/NaN|undefined/);
      expect(texts.main).toBe('$1.00');
    }
  });

  test('approxCents 0 aparece; negativo mantém o sinal; JPY sem casas', () => {
    expect(moneyTexts({ cents: 0, approxCents: 0, approxCurrency: 'JPY' }, 'en').approx).toBe('¥0');
    expect(moneyTexts({ cents: -100, approxCents: -15150, approxCurrency: 'JPY' }, 'en').approx).toBe('-¥152');
    expect(moneyTexts({ cents: 100, approxCents: 1389500, approxCurrency: 'KRW' }, 'pt-BR').approx).toMatch(/13\.895/);
  });

  test('principal em JPY respeita 0 casas; estimated sem valor nunca marca', () => {
    expect(moneyTexts({ cents: 15000, currency: 'JPY' }, 'en').main).toBe('¥150');
    expect(moneyTexts({ cents: null, estimated: true, approxCents: 1, approxCurrency: 'EUR' }, 'en').mainEstimated).toBe(false);
  });
});

describe('storeCounterpart: loja (USD ou BRL) x moeda de conversão (USD, BRL, EUR, JPY)', () => {
  const run = (currency: string, display: string, usdCents: number | null = 1000, approxCents: number | null = 5400) =>
    storeCounterpart({ currency, usdCents, approxCents: display === 'USD' ? null : approxCents, approxCurrency: display === 'USD' ? null : display });

  test('loja USD: o "≈" é o valor na moeda de conversão; com USD de conversão, nada', () => {
    expect(run('USD', 'USD')).toBeNull();
    expect(run('USD', 'BRL')).toEqual({ currency: 'BRL', cents: 5400 });
    expect(run('USD', 'EUR')).toEqual({ currency: 'EUR', cents: 5400 });
    expect(run('USD', 'JPY')).toEqual({ currency: 'JPY', cents: 5400 });
  });

  test('loja BRL: conversão USD ou BRL mostra US$; terceira moeda mostra nela', () => {
    expect(run('BRL', 'USD')).toEqual({ currency: 'USD', cents: 1000 });
    expect(run('BRL', 'BRL')).toEqual({ currency: 'USD', cents: 1000 });
    expect(run('BRL', 'EUR')).toEqual({ currency: 'EUR', cents: 5400 });
    expect(run('BRL', 'JPY')).toEqual({ currency: 'JPY', cents: 5400 });
  });

  test('sem cotação (nulos): nada, ou o US$ quando existe', () => {
    expect(run('USD', 'EUR', 1000, null)).toBeNull();
    expect(run('BRL', 'EUR', null, null)).toBeNull();
    expect(run('BRL', 'EUR', 1000, null)).toEqual({ currency: 'USD', cents: 1000 });
    expect(run('BRL', 'BRL', null)).toBeNull();
    expect(storeCounterpart({ currency: 'USD', usdCents: 1, approxCents: 5, approxCurrency: undefined })).toBeNull();
    expect(storeCounterpart({ currency: 'BRL', usdCents: 1, approxCents: 5, approxCurrency: undefined })).toEqual({ currency: 'USD', cents: 1 });
  });

  test('loja em JPY com conversão em JPY: US$; zero é valor válido', () => {
    expect(run('JPY', 'JPY')).toEqual({ currency: 'USD', cents: 1000 });
    expect(run('USD', 'EUR', 0, 0)).toEqual({ currency: 'EUR', cents: 0 });
    expect(run('BRL', 'BRL', 0)).toEqual({ currency: 'USD', cents: 0 });
  });
});

describe('currencyChangeView: carregando, erro e sem cotação', () => {
  const preview = (extra: Partial<CurrencyChangePreview> = {}): CurrencyChangePreview => ({
    currency: 'EUR', steamStore: null, fxRateAvailable: true, automaticSource: true, ...extra,
  });

  test('prévia carregando ou com erro (null): nenhum aviso e nenhuma busca, para todas as moedas', () => {
    for (const currency of CURRENCIES) {
      const view = currencyChangeView(null, currency);
      expect(view).toMatchObject({ noRate: 'NONE', fetchRateAfter: false, steamLines: [] });
      expect(steamChoiceFor(view, {})).toBe('KEEP');
      expect(view.toBase).toBe(currency === 'USD');
    }
  });

  test('sem cotação: AUTO busca depois; MANUAL não busca', () => {
    expect(currencyChangeView(preview({ fxRateAvailable: false }), 'JPY')).toMatchObject({ noRate: 'AUTO', fetchRateAfter: true });
    expect(currencyChangeView(preview({ fxRateAvailable: false, automaticSource: false }), 'JPY')).toMatchObject({ noRate: 'MANUAL', fetchRateAfter: false });
  });

  test('USD ignora a prévia mesmo sem cotação; sem loja Steam na prévia a escolha é KEEP', () => {
    for (const p of [null, preview({ currency: 'USD', fxRateAvailable: false }), preview({ fxRateAvailable: false, automaticSource: false })]) {
      for (const currency of ['USD', 'EUR']) expect(steamChoiceFor(currencyChangeView(p, currency), { FOLLOW: true, NEW_STORE: true })).toBe('KEEP');
    }
    expect(currencyChangeView(preview({ currency: 'USD', fxRateAvailable: false }), 'USD')).toMatchObject({ toBase: true, noRate: 'NONE', fetchRateAfter: false });
  });
});

describe('modal e seletor: ligação do fluxo (ambiente node, sem DOM)', () => {
  const modal = read('components/CurrencyChangeModal.tsx');
  const select = read('components/CurrencySelect.tsx');
  const confirmBody = modal.slice(modal.indexOf('const confirm'), modal.indexOf('return ('));

  test('escolher a mesma moeda gravada não abre o modal nem chama a API', () => {
    expect(select).toMatch(/if \(event\.target\.value !== displayCurrency\) setPending\(event\.target\.value\)/);
    expect(select).not.toMatch(/changeDisplayCurrency|updatePreferences|services\/api/);
  });

  test('o select é controlado por displayCurrency (volta à moeda gravada); o modal é remontado a cada moeda', () => {
    expect(select).toMatch(/value=\{displayCurrency\}/);
    expect(select).toMatch(/onClose=\{\(\) => setPending\(null\)\}/);
    expect(select).toMatch(/key=\{pending\}/);
  });

  test('cancelar chama só onClose; o único changeDisplayCurrency está em confirm', () => {
    expect(modal.match(/changeDisplayCurrency\(/g)).toHaveLength(1);
    expect(modal).toMatch(/onClick=\{onClose\} disabled=\{busy\}/);
    expect(confirmBody).toMatch(/changeDisplayCurrency\(currency, steamChoiceFor\(view, checks\)\)/);
  });

  test('falha do PATCH: erro traduzido, modal continua aberto e o botão é liberado', () => {
    const catchBlock = confirmBody.slice(confirmBody.indexOf('.catch((err: unknown)'));
    expect(catchBlock).toMatch(/setError\(errorMessageFor\(err, tLoose, locale\)\)/);
    expect(catchBlock).toMatch(/setBusy\(false\)/);
    expect(catchBlock).not.toMatch(/onClose/);
  });

  test('falha da busca da cotação depois de gravar é engolida e a troca vale (onClose roda)', () => {
    const thenBlock = confirmBody.slice(confirmBody.indexOf('.then(async'), confirmBody.indexOf('.catch((err: unknown)'));
    expect(thenBlock).toMatch(/await refreshFxRate\(currency\)\.catch\(\(\) => undefined\)/);
    expect(thenBlock).toMatch(/onClose\(\)/);
  });

  test('confirmar fica desabilitado enquanto a prévia carrega; erro na prévia libera e avisa', () => {
    expect(modal).toMatch(/disabled=\{busy \|\| preview\.isPending\}/);
    expect(modal).toMatch(/preview\.isError &&/);
    expect(modal).toMatch(/retry: false/);
  });

  test('o erro do PATCH aparece traduzido nos dois idiomas', () => {
    for (const [dict, locale] of [[ptBR, 'pt-BR'], [en, 'en']] as const) {
      const t = (key: string, params?: Record<string, string | number>) => translate(dict, key, params);
      for (const code of ['INVALID_FIELD', 'FX_RATE_OUT_OF_RANGE', 'NETWORK_ERROR']) {
        const message = errorMessageFor(new ApiRequestError(code, 'cru do backend', 400, {}), t, locale);
        expect(message).not.toBe('cru do backend');
        expect(message).not.toMatch(/^errors\./);
        expect(message.length).toBeGreaterThan(5);
      }
    }
  });
});

describe('fxRates: bordas', () => {
  const NOW = new Date('2026-11-25T12:00:00.000Z');
  const DAY = 86_400_000;
  const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  const entry = (currency: string, extra: Partial<FxRateEntry> = {}): FxRateEntry => ({
    currency, rate: 2, source: 'AWESOMEAPI', refreshSource: 'AWESOMEAPI', quotedAt: at(0), updatedAt: at(0), ...extra,
  });

  test('fronteira de 3 dias: 3d exatos e 3d23h59 não são antigas; 4d exatos são (dias inteiros)', () => {
    expect(FX_STALE_AFTER_DAYS).toBe(3);
    expect(isFxRateStale(entry('EUR', { quotedAt: at(3 * DAY) }), NOW)).toBe(false);
    expect(isFxRateStale(entry('EUR', { quotedAt: at(4 * DAY - 1) }), NOW)).toBe(false);
    expect(isFxRateStale(entry('EUR', { quotedAt: at(4 * DAY) }), NOW)).toBe(true);
    expect(fxRateAgeDays(at(4 * DAY - 1), NOW)).toBe(3);
  });

  test('data futura: idade 0, nunca antiga; data inválida ou vazia: idade nula, nunca antiga', () => {
    const future = new Date(NOW.getTime() + 10 * DAY).toISOString();
    expect(fxRateAgeDays(future, NOW)).toBe(0);
    expect(isFxRateStale(entry('EUR', { quotedAt: future }), NOW)).toBe(false);
    for (const bad of ['', 'ontem', '2026-13-45', 'NaN']) {
      expect(fxRateAgeDays(bad, NOW)).toBeNull();
      expect(isFxRateStale(entry('EUR', { quotedAt: bad }), NOW)).toBe(false);
    }
  });

  test('a PTAX também pode ficar antiga; MANUAL nunca', () => {
    expect(isFxRateStale(entry('BRL', { source: 'PTAX', quotedAt: at(10 * DAY) }), NOW)).toBe(true);
    expect(isFxRateStale(entry('BRL', { source: 'MANUAL', quotedAt: at(10 * DAY) }), NOW)).toBe(false);
  });

  test('buildFxRows: dedupe, USD fora, moeda de conversão primeiro; linha sem entrada tem rate nulo', () => {
    const rows = buildFxRows(['JPY', 'BRL', 'JPY', 'USD', 'BRL', 'EUR'], [entry('BRL')], 'EUR', NOW);
    expect(rows.map((r) => r.currency)).toEqual(['EUR', 'BRL', 'JPY']);
    expect(rows[0]).toMatchObject({ isDisplay: true, entry: null, rate: null });
    expect(rows[2].rate).toBeNull();
  });

  test('moeda de conversão USD: ninguém é "display" e USD não entra na lista', () => {
    const rows = buildFxRows(['BRL', 'EUR'], [], 'USD', NOW);
    expect(rows.every((r) => !r.isDisplay)).toBe(true);
    expect(rows.map((r) => r.currency)).toEqual(['BRL', 'EUR']);
  });

  test('currenciesToAutoRefresh: ordenada, sem repetição, sem USD e sem MANUAL', () => {
    expect(currenciesToAutoRefresh(['USD'], [])).toEqual([]);
    expect(currenciesToAutoRefresh(['USD', 'JPY', 'BRL', 'JPY', 'EUR'], [])).toEqual(['BRL', 'EUR', 'JPY']);
    expect(currenciesToAutoRefresh(['EUR', 'JPY'], [entry('JPY', { source: 'MANUAL' }), entry('EUR', { source: null })])).toEqual(['EUR']);
  });
});

describe('FxAutoRefreshHost: laço (ligação pelo código-fonte)', () => {
  const host = read('components/FxAutoRefreshHost.tsx');
  const loop = host.slice(host.indexOf('for (const currency of currencies)'), host.indexOf('if (refreshed)'));

  test('em série: await dentro do for, sem Promise.all', () => {
    expect(loop).toMatch(/await refreshFxRate\(/);
    expect(host).not.toMatch(/Promise\.all/);
  });

  test('erro de rede para o laço uma vez só e limpa a falha; outros erros seguem para a próxima moeda', () => {
    expect(loop.match(/reportStartup\('fx', 'OFFLINE'\)/g)).toHaveLength(1);
    expect(loop).toMatch(/firstFailure = null;\s*break;/);
    const afterBreak = loop.slice(loop.indexOf('break;') + 6);
    expect(afterBreak).toMatch(/if \(firstFailure === null\) firstFailure = \{ currency, error: err \}/);
    expect(afterBreak).not.toMatch(/break|return/);
  });

  test('skipped (ALREADY_RAN, MANUAL_RATE, BUSY) não é erro: só result.quote conta como atualizado', () => {
    expect(loop).toMatch(/if \(result\.quote\) refreshed = true/);
    expect(loop).not.toMatch(/skipped/);
    const types = read('types/api.ts');
    for (const reason of ['ALREADY_RAN', 'MANUAL_RATE', 'BUSY']) expect(types).toContain(reason);
  });

  test('uma tentativa por carga e o aviso mostra só a primeira moeda com erro', () => {
    expect(host).toMatch(/let attemptedThisPage = false/);
    expect(host).toMatch(/if \(started\.current \|\| attemptedThisPage\)/);
    expect(host).toMatch(/if \(firstFailure\) setFailure/);
  });

  test('sem nada a atualizar, nenhum timer é criado', () => {
    expect(host).toMatch(/if \(currencies\.length === 0\) return undefined;[\s\S]*setTimeout/);
  });
});

describe('paridade de textos e varredura do "≈"', () => {
  const flatten = (obj: unknown, prefix = ''): string[] =>
    obj !== null && typeof obj === 'object'
      ? Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
      : [prefix];
  const get = (dict: unknown, key: string) => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict);

  test('en e pt-BR têm exatamente as mesmas chaves', () => {
    const a = new Set(flatten(en));
    const b = new Set(flatten(ptBR));
    expect([...a].filter((k) => !b.has(k))).toEqual([]);
    expect([...b].filter((k) => !a.has(k))).toEqual([]);
  });

  test('chaves da 11.3 existem e têm os mesmos {placeholders} nos dois idiomas', () => {
    const keys = flatten(en).filter((k) => /^(currency\.|settings\.fx\.|errors\.FX_RATE_OUT_OF_RANGE)/.test(k));
    expect(keys.length).toBeGreaterThan(10);
    const params = (s: unknown) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of keys) {
      expect(get(en, key), key).toBeTruthy();
      expect(get(ptBR, key), key).toBeTruthy();
      expect(params(get(en, key)), key).toEqual(params(get(ptBR, key)));
    }
  });

  test('nenhum texto genérico do "≈" fixa "R$"', () => {
    for (const dict of [en, ptBR]) {
      expect(dict.common.approx).not.toMatch(/R\$|BRL/);
      expect(dict.common.approx).not.toMatch(/R\$|BRL/);
      expect(JSON.stringify(get(dict, 'currency'))).not.toMatch(/R\$|reais/i);
    }
  });

  test('seletor: 17 opções únicas com texto, nos dois idiomas', () => {
    for (const locale of LOCALES) {
      const options = currencyOptions(locale);
      expect(options).toHaveLength(17);
      expect(new Set(options.map((o) => o.code)).size).toBe(17);
      for (const o of options) expect(o.label).not.toMatch(BAD);
    }
  });

  // Varre TODOS os arquivos de produção (não só uma lista fixa): nenhum fixa BRL ou "R$" na formatação do aproximado.
  const walk = (dir: string): string[] =>
    fs.readdirSync(path.join(src, dir), { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(path.join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) && !/\.test\./.test(d.name) ? [path.join(dir, d.name).replace(/\\/g, '/')] : [],
    );
  const prod = ['app', 'components', 'lib'].flatMap(walk);

  test('a varredura inclui MinPriceCell e SellItemModal (fora da lista do teste antigo)', () => {
    const withApprox = prod.filter((f) => /approx/i.test(read(f)));
    expect(withApprox).toEqual(expect.arrayContaining(['components/MinPriceCell.tsx', 'components/SellItemModal.tsx', 'components/MoneyApprox.tsx']));
  });

  // Formulários de loja só conhecem US$ e R$ até a 11.4 (lojas nas 17 moedas): o "R$" fixo deles não é "≈" e fica fora desta varredura.
  const UNTIL_11_4 = ['components/StoreBalanceFormModal.tsx', 'components/StoreFormModal.tsx'];

  test.each(prod.filter((f) => !UNTIL_11_4.includes(f)))('%s: sem BRL fixo em linha com approx e sem "R$" literal em texto de tela', (file) => {
    const lines = read(file).split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line));
    for (const line of lines) {
      const code = line.replace(/\s\/\/.*$/, '').replace(/\{\/\*.*?\*\/\}/g, '');
      if (/approx/i.test(code)) expect(code, `${file}: ${line.trim()}`).not.toMatch(/'BRL'|"BRL"|R\$/);
      expect(code, `${file}: ${line.trim()}`).not.toMatch(/['"`>]\s*≈?\s*R\$/);
    }
  });
});
