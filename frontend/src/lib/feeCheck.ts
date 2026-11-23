// Avisos de taxa da conta diferente da loja (D314, D316). Funções puras sobre o `feeCheck` devolvido pelo backend.
import type { FeeCheck } from '@/types/api';
import { formatPercent } from './format';

type LooseT = (key: string, params?: Record<string, string | number>) => string;

export interface FeeWarning {
  kind: 'sale' | 'withdrawal';
  text: string;
}

// Um aviso por taxa que difere (`matches === false`); `null` (sem como comparar) não avisa.
export function buildFeeWarnings(feeCheck: FeeCheck | null, storeName: string, locale: string, t: LooseT): FeeWarning[] {
  if (!feeCheck) return [];
  const warnings: FeeWarning[] = [];
  if (feeCheck.saleFeeMatches === false && feeCheck.accountSaleFeeRate !== null && feeCheck.storeSaleFeeRate !== null) {
    warnings.push({
      kind: 'sale',
      text: t('settings.integrations.csfloat.saleFeeMismatch', {
        account: formatPercent(feeCheck.accountSaleFeeRate, locale),
        store: storeName,
        configured: formatPercent(feeCheck.storeSaleFeeRate, locale),
      }),
    });
  }
  if (feeCheck.withdrawalFeeMatches === false && feeCheck.accountWithdrawalFeeRate !== null && feeCheck.storeWithdrawalFeeRate !== null) {
    warnings.push({
      kind: 'withdrawal',
      text: t('settings.integrations.csfloat.withdrawalFeeMismatch', {
        account: formatPercent(feeCheck.accountWithdrawalFeeRate, locale),
        store: storeName,
        configured: formatPercent(feeCheck.storeWithdrawalFeeRate, locale),
      }),
    });
  }
  return warnings;
}

// Corpo do PATCH da loja só com as taxas que diferem; `null` quando não há o que atualizar.
export function buildFeeUpdateBody(feeCheck: FeeCheck | null): { saleFeeRate?: number; withdrawalFeeRate?: number } | null {
  if (!feeCheck) return null;
  const body: { saleFeeRate?: number; withdrawalFeeRate?: number } = {};
  if (feeCheck.saleFeeMatches === false && feeCheck.accountSaleFeeRate !== null) body.saleFeeRate = feeCheck.accountSaleFeeRate;
  if (feeCheck.withdrawalFeeMatches === false && feeCheck.accountWithdrawalFeeRate !== null) {
    body.withdrawalFeeRate = feeCheck.accountWithdrawalFeeRate;
  }
  return Object.keys(body).length > 0 ? body : null;
}

// Depois de atualizar a loja, as taxas passam a coincidir (o aviso some sem nova chamada ao CSFloat).
export function applyFeeUpdate(feeCheck: FeeCheck): FeeCheck {
  return {
    ...feeCheck,
    storeSaleFeeRate: feeCheck.saleFeeMatches === false ? feeCheck.accountSaleFeeRate : feeCheck.storeSaleFeeRate,
    saleFeeMatches: feeCheck.saleFeeMatches === false ? true : feeCheck.saleFeeMatches,
    storeWithdrawalFeeRate: feeCheck.withdrawalFeeMatches === false ? feeCheck.accountWithdrawalFeeRate : feeCheck.storeWithdrawalFeeRate,
    withdrawalFeeMatches: feeCheck.withdrawalFeeMatches === false ? true : feeCheck.withdrawalFeeMatches,
  };
}
