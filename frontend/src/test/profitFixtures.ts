// Fixtures do Lucro real e dos saldos das lojas (12.7b). Não entram no app.
import type { ProfitSummary, StoreBalanceSummary } from '@/types/api';

export function makeBalance(overrides: Partial<StoreBalanceSummary> = {}): StoreBalanceSummary {
  return {
    storeId: 1, storeName: 'CSFloat', currency: 'USD', isActive: true, allowsWithdrawal: true, saleHoldDays: 7,
    lastCheck: null, daysSinceLastCheck: null,
    breakdown: { depositsCents: 100000, purchasesCents: 20000, withdrawalsCents: 10000, salesReleasedCents: 5000, adjustmentsCents: 0 },
    availableCents: 75000, availableUsdCents: 75000, availableApproxCents: 375000, approxCurrency: 'BRL', availableEstimated: false,
    negative: false,
    pending: { cents: 0, count: 0, nextReleaseAt: null, usdCents: 0, approxCents: 0, estimated: false },
    ignored: { legacyDeposits: 0, currencyMismatch: 0 },
    estimated: false, warningCode: null,
    ...overrides,
  };
}

export function makeProfit(overrides: Partial<ProfitSummary> = {}): ProfitSummary {
  return {
    baseCurrency: 'USD',
    depositsUsdCents: 100000, withdrawalsNetUsdCents: 20000, platformBalanceUsdCents: 75000, pendingBalanceUsdCents: 5000,
    nextReleaseAt: '2026-11-30T12:00:00.000Z', stockUsdCents: 30000,
    stockBreakdown: {
      forSale: { usdCents: 20000, estimated: false, approx: 100000, count: 4 },
      offSale: { usdCents: 10000, estimated: false, approx: 50000, count: 2 },
    },
    realProfitUsdCents: 30000, estimated: false,
    estimatedParts: { deposits: false, withdrawals: false, platformBalance: false, pendingBalance: false, stock: false },
    approxCurrency: 'BRL',
    approx: { deposits: 500000, withdrawals: 100000, platformBalance: 375000, pendingBalance: 25000, stock: 150000, realProfit: 150000 },
    withdrawnVsDeposited: { withdrawnUsdCents: 20000, depositedUsdCents: 100000, ratio: 0.2 },
    balancesByStore: [makeBalance()],
    counts: { deposits: 2, legacyDeposits: 0, withdrawals: 1, legacyWithdrawals: 0, withdrawalsWithoutFee: 0, stockItems: 6, pendingSales: 1 },
    warnings: [],
    fx: { usdBrlRate: 5, source: 'AWESOMEAPI', updatedAt: '2026-11-27T10:00:00.000Z', quotedAt: '2026-11-27T09:00:00.000Z', displayCurrency: 'BRL' },
    computedAt: '2026-11-27T10:00:00.000Z',
    ...overrides,
  } as ProfitSummary;
}
