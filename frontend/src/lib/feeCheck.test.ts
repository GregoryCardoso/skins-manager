import { describe, expect, test } from 'vitest';
import { applyFeeUpdate, buildFeeUpdateBody, buildFeeWarnings } from './feeCheck';
import type { FeeCheck } from '@/types/api';

const t = (key: string, params?: Record<string, string | number>) => `${key}|${JSON.stringify(params ?? {})}`;

const same: FeeCheck = {
  accountSaleFeeRate: 0.02, storeSaleFeeRate: 0.02, saleFeeMatches: true,
  accountWithdrawalFeeRate: 0.025, storeWithdrawalFeeRate: 0.025, withdrawalFeeMatches: true,
};
const diff: FeeCheck = {
  accountSaleFeeRate: 0.015, storeSaleFeeRate: 0.02, saleFeeMatches: false,
  accountWithdrawalFeeRate: 0.03, storeWithdrawalFeeRate: 0.025, withdrawalFeeMatches: false,
};

describe('feeCheck', () => {
  test('sem diferença ou sem comparação não gera aviso nem corpo de atualização', () => {
    expect(buildFeeWarnings(null, 'CSFloat', 'pt-BR', t)).toEqual([]);
    expect(buildFeeWarnings(same, 'CSFloat', 'pt-BR', t)).toEqual([]);
    expect(buildFeeWarnings({ ...same, saleFeeMatches: null, withdrawalFeeMatches: null }, 'CSFloat', 'pt-BR', t)).toEqual([]);
    expect(buildFeeUpdateBody(same)).toBeNull();
    expect(buildFeeUpdateBody(null)).toBeNull();
  });

  test('uma taxa diferente gera um aviso com os percentuais e a loja', () => {
    const warnings = buildFeeWarnings({ ...same, accountSaleFeeRate: 0.015, saleFeeMatches: false }, 'CSFloat', 'en', t);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe('sale');
    expect(warnings[0].text).toContain('settings.integrations.csfloat.saleFeeMismatch');
    expect(warnings[0].text).toContain('"store":"CSFloat"');
    expect(warnings[0].text).toContain('"configured":"2%"');
  });

  test('as duas diferentes: dois avisos e o corpo leva só as taxas que diferem', () => {
    expect(buildFeeWarnings(diff, 'CSFloat', 'pt-BR', t).map((w) => w.kind)).toEqual(['sale', 'withdrawal']);
    expect(buildFeeUpdateBody(diff)).toEqual({ saleFeeRate: 0.015, withdrawalFeeRate: 0.03 });
    expect(buildFeeUpdateBody({ ...same, withdrawalFeeMatches: false, accountWithdrawalFeeRate: 0.03 })).toEqual({ withdrawalFeeRate: 0.03 });
  });

  test('applyFeeUpdate faz as taxas passarem a coincidir', () => {
    const updated = applyFeeUpdate(diff);
    expect(updated).toMatchObject({ storeSaleFeeRate: 0.015, saleFeeMatches: true, storeWithdrawalFeeRate: 0.03, withdrawalFeeMatches: true });
    expect(buildFeeWarnings(updated, 'CSFloat', 'pt-BR', t)).toEqual([]);
  });
});
