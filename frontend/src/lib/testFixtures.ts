// Fixtures dos testes (não é arquivo de teste nem entra no app).
import type { ItemView, Store } from '@/types/api';

// Loja completa com padrões; os testes sobrescrevem só o que importa.
export function makeStore(overrides: Partial<Store> = {}): Store {
  return {
    id: 1, name: 'Loja', currency: 'USD', isActive: true, isPrimary: false, saleFeeType: null, saleFeeRate: null,
    saleFeeRounding: 'CEIL', saleMinFeeCents: null, saleFixedFeeCents: 0, allowsWithdrawal: false,
    withdrawalFeeRate: null, withdrawalFixedFeeCents: 0, saleHoldDays: 0, createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', saleFeesConfigured: false, inUse: false, ...overrides,
  };
}

export const STORES: Store[] = [
  makeStore({ id: 1, name: 'CSFloat', isPrimary: true, saleFeeType: 'DEDUCTED', saleFeeRate: 0.02, saleFeesConfigured: true }),
  makeStore({ id: 2, name: 'Steam', currency: 'BRL', saleFeeType: 'ADDED', saleFeeRate: 0.15, saleFeesConfigured: true }),
  makeStore({ id: 3, name: 'CSMoney' }),
  makeStore({ id: 4, name: 'Antiga', isActive: false, saleFeeType: 'DEDUCTED', saleFeeRate: 0.02, saleFeesConfigured: true }),
];

export function makeItem(overrides: Partial<ItemView> = {}): ItemView {
  return {
    id: 10,
    name: 'AK-47 | Redline',
    category: 'SKIN',
    catalogId: 'skin-ak-redline',
    isLegacy: false,
    catalog: {
      id: 'skin-ak-redline', name: 'AK-47 | Redline', namePtBr: 'AK-47 | Linha Vermelha', imageUrl: null,
      minFloat: 0.1, maxFloat: 0.7, hasStattrak: true, hasSouvenir: false, phase: null,
    },
    variant: 'NORMAL',
    floatValue: 0.2,
    exterior: 'FT',
    paintSeed: null,
    phase: null,
    inspectLink: null,
    assetId: null,
    acquisitionType: 'COMPRA',
    originDetail: null,
    purchaseStoreId: 1,
    purchasePriceCents: 100,
    purchaseCurrency: 'USD',
    fxRateAtPurchase: null,
    acquiredAt: '2026-11-10T12:00:00.000Z',
    tradeUnlockAt: null,
    status: 'EM_ESTOQUE',
    saleStoreId: null,
    salePriceCents: null,
    saleCurrency: null,
    fxRateAtSale: null,
    netReceivedCents: null,
    netReceivedManual: false,
    soldAt: null,
    tradeLock: { isLocked: false, remainingMs: 0, formatted: 'Liberado', tradeUnlockAt: null },
    aging: { daysInInventory: 9, daysForSale: 9, agingBucket: 'EM_GIRO' },
    minPrices: [],
    saleProfitUsdCents: null,
    saleInfo: null,
    saleRelease: null,
    saleState: 'FOR_SALE',
    offSaleAt: null,
    forSaleSince: null,
    soldWhileOffSale: false,
    externalSource: null,
    components: [],
    componentSummary: { stickers: 0, charms: 0 },
    cost: { ownUsdCents: 100, inheritedUsdCents: 0, effectiveUsdCents: 100, estimated: false },
    consumedIn: null,
    generatedFrom: null,
    openable: null,
    canReceiveComponents: true,
    stats: { unitCount: 1, consumedCount: 0, lossCount: 0, lossUsdCents: 0, soldWithFxCount: 0, soldCount: 0, soldOffSaleCount: 0, avgDaysToSell: null, avgPurchaseCostUsdCents: null, avgSalePriceUsdCents: null, avgProfitUsdCents: null },
    ...overrides,
  };
}
