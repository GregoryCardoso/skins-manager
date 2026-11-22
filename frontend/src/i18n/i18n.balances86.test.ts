import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { API_ERROR_CODES, WARNING_CODES } from './errorCodes';
import en from './en.json';
import ptBR from './pt-BR.json';
import { translate } from './translate';

// 8.6 (D247): saldo calculado das lojas. Paridade de chaves, textos obrigatórios e remoção das chaves antigas.
const holders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

function flatten(node: unknown, prefix = ''): string[] {
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [full] : flatten(value, full);
  });
}

const NEW_KEYS = [
  'storeBalances.computed', 'storeBalances.difference', 'storeBalances.startHint', 'storeBalances.totalsTitle', 'storeBalances.totalPendingDate',
  'storeBalances.lastCheckToday', 'storeBalances.neverChecked', 'storeBalances.check', 'storeBalances.checkPreview',
  'storeBalances.adjustAndSave', 'storeBalances.saveCheckOnly', 'storeBalances.adjustmentNote',
  'storeBalances.kind.CHECK', 'storeBalances.kind.LEGACY',
  'storeBalances.breakdown.deposits', 'storeBalances.breakdown.purchases',
  'storeBalances.breakdown.withdrawals', 'storeBalances.breakdown.salesReleased', 'storeBalances.breakdown.adjustments',
  'storeBalances.lastCheckDays.one', 'storeBalances.lastCheckDays.other', 'storeBalances.legacyDepositsIgnored.one',
  'storeBalances.legacyDepositsIgnored.other', 'warnings.COMPUTED_BALANCE_NEGATIVE', 'warnings.BALANCE_CURRENCY_MISMATCH',
  'errors.ADJUSTMENT_NOTE_REQUIRED', 'errors.BALANCE_CHECK_BEFORE_LAST',
];

const REMOVED_KEYS = [
  'storeBalances.releasedAfterBalance', 'storeBalances.releasedNoBalance', 'storeBalances.outdatedReleased',
  'storeBalances.noBalance', 'storeBalances.recordedAt', 'storeBalances.update', 'storeBalances.created',
  'storeBalances.totalReleased', 'storeBalances.initial', 'storeBalances.noInitial', 'storeBalances.setInitial',
  'storeBalances.editInitial', 'storeBalances.deleteInitial', 'storeBalances.initialHistoryHint', 'storeBalances.initialSaved',
  'storeBalances.initialDeleted', 'storeBalances.initialForm.title', 'storeBalances.history.deleteInitialMessage',
  'storeBalances.breakdown.initial', 'storeBalances.kind.INITIAL', 'errors.BALANCE_CHECK_BEFORE_INITIAL', 'warnings.BALANCE_MAYBE_OUTDATED', 'profit.releasedIncluded', 'profit.summary.releasedUnavailable',
];

describe('8.6: chaves do saldo calculado', () => {
  test('pt-BR e en têm exatamente as mesmas chaves e os mesmos {marcadores}', () => {
    expect(flatten(en).sort()).toEqual(flatten(ptBR).sort());
    for (const key of flatten(ptBR)) expect(holders(translate(en, key)), key).toEqual(holders(translate(ptBR, key)));
  });

  test.each(NEW_KEYS)('%s existe e não é vazia nos dois idiomas', (key) => {
    for (const dict of [ptBR, en]) {
      const text = translate(dict, key);
      expect(text).not.toBe(key);
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  test('a orientação "registre um aporte com o saldo atual" existe com o texto confirmado (D254)', () => {
    expect(translate(ptBR, 'storeBalances.startHint')).toBe(
      'Não quer lançar o histórico antigo? Registre um aporte com o saldo atual da loja. O lucro real passa a ser medido a partir dessa data.'
    );
    expect(translate(en, 'storeBalances.startHint')).toBe(
      "Don't want to enter your old history? Record a deposit with the store's current balance. Real profit will be measured from that date on."
    );
    expect(translate(ptBR, 'storeBalances.totalsTitle')).toBe('Total nas lojas');
    expect(translate(en, 'storeBalances.totalsTitle')).toBe('Total in stores');
  });

  test('o painel e o modal de aporte mostram a orientação; os totais ficam antes da lista de lojas (D255)', () => {
    const dir = path.join(__dirname, '..', 'components');
    const panel = readFileSync(path.join(dir, 'StoreBalancesPanel.tsx'), 'utf-8');
    expect(panel).toContain("t('storeBalances.startHint')");
    expect(readFileSync(path.join(dir, 'DepositFormModal.tsx'), 'utf-8')).toContain("t('storeBalances.startHint')");
    expect(panel.indexOf("t('storeBalances.totalsTitle')")).toBeGreaterThan(-1);
    expect(panel.indexOf("t('storeBalances.totalsTitle')")).toBeLessThan(panel.indexOf('<ul className={styles.list}>'));
  });

  test('nada no código ou nos textos fala em saldo inicial; os arquivos do saldo inicial foram apagados', () => {
    const src = path.join(__dirname, '..');
    for (const file of ['components/InitialBalanceFormModal.tsx', 'lib/initialBalanceForm.ts', 'lib/initialBalanceForm.test.ts']) {
      expect(existsSync(path.join(src, file)), file).toBe(false);
    }
    for (const dict of [ptBR, en]) {
      const text = JSON.stringify(dict).toLowerCase();
      expect(text).not.toMatch(/saldo inicial|starting balance|initial balance/);
    }
  });

  test.each(REMOVED_KEYS)('chave antiga %s saiu dos dois idiomas e não é mais usada no código', (key) => {
    expect(translate(ptBR, key)).toBe(key);
    expect(translate(en, key)).toBe(key);
    const dir = path.join(__dirname, '..', 'components');
    for (const file of ['StoreBalancesPanel.tsx', 'StoreBalanceFormModal.tsx', 'StoreBalanceHistory.tsx', 'SummaryCards.tsx']) {
      expect(readFileSync(path.join(dir, file), 'utf-8'), `${file} ${key}`).not.toContain(`'${key}'`);
    }
  });

  test('códigos novos: lista de erros, lista de avisos e texto nos dois idiomas', () => {
    for (const code of ['ADJUSTMENT_NOTE_REQUIRED', 'BALANCE_CHECK_BEFORE_LAST']) {
      expect(API_ERROR_CODES as readonly string[]).toContain(code);
    }
    expect(API_ERROR_CODES as readonly string[]).not.toContain('BALANCE_CHECK_BEFORE_INITIAL');
    for (const code of ['COMPUTED_BALANCE_NEGATIVE', 'BALANCE_CURRENCY_MISMATCH']) expect(WARNING_CODES as readonly string[]).toContain(code);
    expect(WARNING_CODES as readonly string[]).not.toContain('BALANCE_MAYBE_OUTDATED');
  });
});
