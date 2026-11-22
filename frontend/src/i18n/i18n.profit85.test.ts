import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { API_ERROR_CODES } from '@/i18n/errorCodes';
import { translate, translatePlural } from '@/i18n/translate';

// 8.5 (D230): textos novos nos dois idiomas, com as mesmas chaves e os mesmos {marcadores}; código novo em errorCodes.ts.
const holders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

const KEYS = [
  'deposits.amountStore', 'deposits.noUsdStores', 'deposits.legacyStoreNotUsd', 'deposits.amountBrlOptional', 'deposits.legacyBadge',
  'deposits.legacyEditHint', 'deposits.columns.paid', 'deposits.form.storeRequired', 'deposits.form.chooseStore',
  'withdrawals.amountBrlOptional', 'withdrawals.net', 'withdrawals.legacyRecordedBrl',
  'profit.summary.brlApprox', 'profit.summary.warningDeposits', 'profit.summary.warningWithdrawals',
  'DEPOSIT_STORE_CURRENCY_NOT_ALLOWED',
];

describe('textos da 8.5', () => {
  test.each(KEYS)('a chave %s existe nos dois idiomas com os mesmos marcadores', (key) => {
    const fullKey = key === 'DEPOSIT_STORE_CURRENCY_NOT_ALLOWED' ? `errors.${key}` : key;
    const pt = translate(ptBR, fullKey);
    const enText = translate(en, fullKey);
    expect(pt, `pt-BR ${fullKey}`).not.toBe(fullKey);
    expect(enText, `en ${fullKey}`).not.toBe(fullKey);
    expect(holders(enText)).toEqual(holders(pt));
  });

  test('plurais de aportes antigos e de saques sem taxa, nos dois idiomas', () => {
    for (const key of ['profit.summary.legacyDeposits', 'profit.summary.withdrawalsWithoutFee']) {
      for (const [dict, locale] of [[ptBR, 'pt-BR'], [en, 'en']] as const) {
        const one = translatePlural(dict, key, 1, locale);
        const many = translatePlural(dict, key, 3, locale);
        expect(one, `${locale} ${key}.one`).toContain('1');
        expect(many, `${locale} ${key}.other`).toContain('3');
        expect(one).not.toBe(many);
      }
    }
  });

  test('o texto do erro novo é o do D230', () => {
    expect(translate(ptBR, 'errors.DEPOSIT_STORE_CURRENCY_NOT_ALLOWED')).toBe('O aporte só pode ser registrado em loja em dólar (US$).');
    expect(translate(en, 'errors.DEPOSIT_STORE_CURRENCY_NOT_ALLOWED')).toBe('Deposits can only be recorded in a US dollar (USD) store.');
  });

  test('o código novo está em errorCodes.ts', () => {
    expect(API_ERROR_CODES).toContain('DEPOSIT_STORE_CURRENCY_NOT_ALLOWED');
  });

  test('o "≈" vem junto do valor: pendente e liberado não repetem o símbolo no texto', () => {
    expect(translate(ptBR, 'profit.pendingIncluded', { amount: '≈ US$ 1,00', date: '25/11' })).toBe('inclui ≈ US$ 1,00 pendente (libera a partir de 25/11)');
    expect(translate(ptBR, 'profit.pendingIncluded', { amount: 'US$ 1,00', date: '25/11' })).not.toContain('≈');
    expect(translate(en, 'profit.releasedIncluded', { amount: 'US$ 1.00' })).not.toContain('≈');
  });

  test('as chaves removidas (valor em R$ obrigatório) não existem mais', () => {
    for (const key of ['deposits.form.amount', 'deposits.form.storeHint', 'withdrawals.form.received', 'withdrawals.form.receivedRequired', 'profit.summary.usdApprox']) {
      expect(translate(ptBR, key), key).toBe(key);
      expect(translate(en, key), key).toBe(key);
    }
  });
});

describe('o frontend não soma nem converte (D74)', () => {
  const root = path.join(__dirname, '..');
  const files = [
    'components/SummaryCards.tsx', 'components/StoreBalancesPanel.tsx', 'components/DepositsTable.tsx', 'components/WithdrawalsTable.tsx',
    'components/MoneyApprox.tsx', 'lib/baseMoney.ts',
  ];
  test.each(files)('%s não usa a cotação nem multiplica/divide valores monetários', (file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    expect(source).not.toMatch(/usdBrlRate\s*[*/]|\*\s*(?:rate|usdBrlRate|fx)\b|\/\s*(?:rate|usdBrlRate|fx)\b/);
    expect(source).not.toMatch(/\.reduce\(/);
  });
});
