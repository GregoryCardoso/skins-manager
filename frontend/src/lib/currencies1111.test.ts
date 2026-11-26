import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { errorMessageFor } from '@/i18n/errorMessage';
import { htmlLangFor } from '@/i18n/htmlLang';
import { LANGUAGES } from '@/i18n/languages';
import { translate } from '@/i18n/translate';
import { ApiRequestError } from '@/services/api';
import {
  CURRENCIES, ZERO_DECIMAL_CURRENCIES, currencyLabel, currencyName, hasNoDecimals, invalidMoneyKey, moneyErrorParams,
} from './currencies';
import { formatCentsInput, isAmbiguousDecimal, parseDecimalInput, parseMoneyToCents } from './numberInput';
import { formatMoney } from './format';
import { MAX_AMOUNT_CENTS_BY_CURRENCY, maxAmountCents } from './limits';

// 11.11: as 25 moedas novas (42 no total), a ordem fixa das listas, os erros "inteiro" nas moedas novas sem centavos, o exemplo dos erros
// formatado pelo idioma (B7), a cotação ambígua (B6) e o atributo `lang` (B5).
const root = path.join(__dirname, '..', '..', '..');
const NEW_CURRENCIES = [
  'INR', 'IDR', 'PHP', 'THB', 'VND', 'MYR', 'SGD', 'CHF', 'NOK', 'SEK', 'DKK', 'CZK', 'HUF', 'COP', 'PEN', 'UYU', 'CRC', 'HKD', 'TWD',
  'NZD', 'ZAR', 'ILS', 'SAR', 'AED', 'QAR',
];
const NEW_WHOLE = ['IDR', 'VND', 'COP', 'CRC', 'HUF', 'TWD'];
const LOCALES = ['de', 'en', 'es', 'fr', 'it', 'pl', 'pt-BR', 'tr', 'ru', 'uk', 'ja', 'zh-CN', 'ko'];

function readBackendList(name: string): string[] {
  const text = fs.readFileSync(path.join(root, 'backend', 'src', 'config', 'constants.js'), 'utf8');
  const match = new RegExp(`const ${name} = Object\\.freeze\\(\\[([^\\]]*)\\]\\)`).exec(text);
  if (!match) throw new Error(`${name} não encontrado`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('S4: as listas de moedas do backend e do frontend são iguais, na mesma ordem', () => {
  test('CURRENCIES', () => {
    expect([...CURRENCIES]).toEqual(readBackendList('CURRENCIES'));
  });

  test('moedas sem casas decimais', () => {
    expect([...ZERO_DECIMAL_CURRENCIES]).toEqual(readBackendList('ZERO_DECIMAL_CURRENCIES'));
  });

  test('USD primeiro e as outras 41 em ordem alfabética; as 25 novas estão todas na lista', () => {
    expect(CURRENCIES[0]).toBe('USD');
    expect(CURRENCIES.slice(1)).toEqual([...CURRENCIES.slice(1)].sort());
    for (const code of NEW_CURRENCIES) expect(CURRENCIES).toContain(code);
    expect(CURRENCIES).toHaveLength(17 + NEW_CURRENCIES.length);
  });
});

describe('as 25 moedas novas: nome nos 13 idiomas e símbolo coerente', () => {
  test.each(LOCALES)('%s: toda moeda tem nome (nunca só o código) e rótulo com o código no começo', (locale) => {
    for (const code of CURRENCIES.filter((c) => c !== 'USD')) {
      expect(currencyName(code, locale)).not.toBe(code);
      expect(currencyLabel(code, locale).startsWith(code)).toBe(true);
    }
  });
});

describe('moedas novas sem casas decimais (IDR, VND, COP, CRC, HUF e TWD)', () => {
  test('hasNoDecimals e a mensagem "número inteiro"', () => {
    for (const code of NEW_WHOLE) {
      expect(hasNoDecimals(code)).toBe(true);
      expect(invalidMoneyKey(code)).toBe('itemForm.invalidMoneyWhole');
      expect(moneyErrorParams('en', code).example).toBe('1500');
    }
    for (const code of NEW_CURRENCIES.filter((c) => !NEW_WHOLE.includes(c))) {
      expect(hasNoDecimals(code)).toBe(false);
      expect(invalidMoneyKey(code)).toBe('itemForm.invalidMoney');
    }
  });

  test.each(NEW_WHOLE)('%s: só inteiros no campo de valor, ida e volta em centavos', (code) => {
    expect(parseMoneyToCents('1500', 'en', code)).toBe(150000);
    expect(parseMoneyToCents('15.5', 'en', code)).toBeNull();
    expect(parseMoneyToCents('15,5', 'pt-BR', code)).toBeNull();
    expect(formatCentsInput(150000, 'en', code)).toBe('1500');
  });

  test.each(NEW_WHOLE)('%s: formatMoney sai sem casas em qualquer locale, mesmo quando o ICU daria 2', (code) => {
    for (const locale of LOCALES) {
      const text = formatMoney(123400, code, locale);
      expect(text).toMatch(/\d/);
      expect(text).not.toMatch(/\d[.,]\d{2}(?!\d)(?!.*\d)/);
    }
    expect(formatMoney(123400, code, 'en')).toMatch(/1,234$/);
  });

  test('valores grandes: IDR e VND em centavos inteiros não perdem precisão', () => {
    // 1 bilhão de rupias = 1e11 centavos (acima do teto de 1e10 do backend, só para checar o formatador).
    expect(formatMoney(18_386_000 * 100, 'IDR', 'en')).toMatch(/18,386,000$/);
    expect(formatMoney(25_840_000 * 100, 'VND', 'en')).toMatch(/25,840,000$/);
    expect(formatMoney(25_840_000 * 100, 'VND', 'pt-BR').replace(/\s/g, ' ')).toBe('₫ 25.840.000');
    // o teto do backend (1e10 centavos = 100 milhões de unidades) e o maior valor possível na conversão ficam abaixo do inteiro seguro
    expect(1e10 * 130000).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe('B7: AMOUNT_PRECISION_INVALID usa o exemplo formatado pelo idioma, nos 13 idiomas', () => {
  test.each(LOCALES)('%s: a mensagem leva a moeda e o exemplo, sem marcador sobrando e sem número fixo no texto', (code) => {
    const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'frontend', 'src', 'i18n', `${code}.json`), 'utf8'));
    expect(dictionary.errorDetails.AMOUNT_PRECISION_INVALID).toContain('{example}');
    expect(dictionary.errorDetails.AMOUNT_PRECISION_INVALID).not.toContain('1500');
    const t = (key: string, params?: Record<string, string | number>) => translate(dictionary, key, params);
    const error = new ApiRequestError('AMOUNT_PRECISION_INVALID', 'msg', 400, { field: 'x', params: { currency: 'IDR', unitCents: 100 } });
    const message = errorMessageFor(error, t, code);
    expect(message).toContain('IDR');
    expect(message).toContain(moneyErrorParams(code, 'IDR').example);
    expect(message).not.toMatch(/[{}]/);
  });

  test('sem params o texto geral (sem exemplo) continua valendo', () => {
    const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'frontend', 'src', 'i18n', 'en.json'), 'utf8'));
    const t = (key: string, params?: Record<string, string | number>) => translate(dictionary, key, params);
    expect(errorMessageFor(new ApiRequestError('AMOUNT_PRECISION_INVALID', 'msg', 400, {}), t, 'en')).toBe('This currency has no decimal places. Enter a whole number.');
  });
});

describe('B6: cotação ambígua ("1,250" em idioma de ponto; "1.250" em idioma de vírgula)', () => {
  test.each(['en', 'ja', 'ko', 'zh-CN'])('%s: "1,250" é ambíguo (1,25 ou 1250) e a cotação é recusada', (language) => {
    expect(isAmbiguousDecimal('1,250', language)).toBe(true);
    expect(parseDecimalInput('1,250', language)).toBeNull();
    expect(parseDecimalInput('12,500', language)).toBeNull();
    // não ambíguos
    expect(parseDecimalInput('1250', language)).toBe(1250);
    expect(parseDecimalInput('1,250.5', language)).toBe(1250.5);
    expect(parseDecimalInput('1.25', language)).toBe(1.25);
    expect(parseDecimalInput('1,25', language)).toBe(1.25);
    expect(parseDecimalInput('0,250', language)).toBe(0.25);
  });

  test.each(['pt-BR', 'de', 'es', 'fr', 'it', 'pl', 'tr', 'ru', 'uk'])('%s: "1.250" é ambíguo', (language) => {
    expect(isAmbiguousDecimal('1.250', language)).toBe(true);
    expect(parseDecimalInput('1.250', language)).toBeNull();
    expect(parseDecimalInput('1.250,5', language)).toBe(1250.5);
    expect(parseDecimalInput('1250', language)).toBe(1250);
    expect(parseDecimalInput('1,25', language)).toBe(1.25);
    expect(parseDecimalInput('0.250', language)).toBe(0.25);
  });

  test('exemplos com ARS e KRW (cotações de milhar)', () => {
    // ARS ~1.610 e KRW ~1.350 por US$: quem escreve "1,350" em en (ou "1.350" em pt-BR) não pode ser lido como 1,35.
    expect(parseDecimalInput('1,350', 'en')).toBeNull();
    expect(parseDecimalInput('1.610', 'pt-BR')).toBeNull();
    expect(parseDecimalInput('1350', 'en')).toBe(1350);
    expect(parseDecimalInput('1610,28', 'pt-BR')).toBe(1610.28);
  });

  test('dinheiro e float não mudam (já recusavam mais de 2 casas)', () => {
    expect(parseMoneyToCents('1,250', 'en')).toBeNull();
    expect(parseMoneyToCents('1.250', 'pt-BR')).toBeNull();
    expect(parseMoneyToCents('1,25', 'en')).toBe(125);
  });

  test('a mensagem existe nos 13 idiomas, com {example}', () => {
    for (const code of LANGUAGES) {
      const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'frontend', 'src', 'i18n', `${code}.json`), 'utf8'));
      expect(dictionary.fx.ambiguousInput).toContain('{example}');
    }
  });

  test('a tela de cotação e os formulários usam a mensagem', () => {
    const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const file of ['components/FxRateSettings.tsx', 'lib/itemForm.ts', 'lib/sellForm.ts', 'lib/pendingActions.ts', 'components/OpenContainerModal.tsx']) {
      expect(read(file)).toContain('fx.ambiguousInput');
    }
  });
});

describe('B5: o lang do <html> segue o idioma do dicionário carregado', () => {
  test('pronto: o idioma carregado (inglês quando o dicionário escolhido falhou); carregando: nada a mudar', () => {
    expect(htmlLangFor('pt-BR', true)).toBe('pt-BR');
    expect(htmlLangFor('en', true)).toBe('en'); // escolheu ja, o import falhou e a tela está em inglês
    expect(htmlLangFor('en', false)).toBeNull();
  });

  test('o I18nProvider grava o lang a partir do idioma carregado, e o PreferencesProvider não grava', () => {
    const provider = fs.readFileSync(path.join(__dirname, '..', 'i18n', 'I18nProvider.tsx'), 'utf8');
    expect(provider).toMatch(/htmlLangFor\(loaded\.language, dictionaryReady\)/);
    expect(provider).toMatch(/setAttribute\('lang', lang\)/);
    const preferences = fs.readFileSync(path.join(__dirname, '..', 'components', 'PreferencesProvider.tsx'), 'utf8');
    expect(preferences).not.toMatch(/setAttribute\('lang'/);
  });
});

describe('S4: teto de valor por moeda igual no backend e no frontend (11.11, complemento)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const backend = createRequire(import.meta.url)(path.join(root, 'backend', 'src', 'config', 'constants.js')) as {
    MAX_AMOUNT_CENTS_BY_CURRENCY: Record<string, number>;
    maxAmountCents: (currency: string) => number;
  };

  test('a tabela do frontend é idêntica à do backend (mesmas moedas, mesmos valores)', () => {
    expect({ ...MAX_AMOUNT_CENTS_BY_CURRENCY }).toEqual({ ...backend.MAX_AMOUNT_CENTS_BY_CURRENCY });
    expect(Object.keys(MAX_AMOUNT_CENTS_BY_CURRENCY)).toEqual([...CURRENCIES]);
  });

  test('maxAmountCents: o teto da moeda; moeda desconhecida usa o maior, como no backend', () => {
    for (const code of [...CURRENCIES, 'XXX', 'constructor']) expect(maxAmountCents(code)).toBe(backend.maxAmountCents(code));
    expect(maxAmountCents('USD')).toBe(1e10);
    expect(maxAmountCents('VND')).toBe(5e13);
  });

  test('o texto do erro INVALID_AMOUNT mostra o teto da moeda do campo, com as casas dela', () => {
    const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'frontend', 'src', 'i18n', 'pt-BR.json'), 'utf8'));
    const t = (key: string, params?: Record<string, string | number>) => translate(dictionary, key, params);
    const vnd = errorMessageFor(new ApiRequestError('INVALID_AMOUNT', 'x', 400, { params: { maxCents: 5e13, currency: 'VND' } }), t, 'pt-BR');
    expect(vnd).toContain('500.000.000.000');
    expect(vnd).not.toContain('500.000.000.000,00');
    const usd = errorMessageFor(new ApiRequestError('INVALID_AMOUNT', 'x', 400, { params: { maxCents: 1e10, currency: 'USD' } }), t, 'pt-BR');
    expect(usd).toContain('100.000.000,00');
  });
});
