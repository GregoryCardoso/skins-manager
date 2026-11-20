// Fixtures dos testes (não é arquivo de teste nem entra no app).
import type { ItemView, Store } from '@/types/api';

export const STORES: Store[] = [
  { id: 1, name: 'CSFloat', currency: 'USD', isActive: true, isPrimary: true, saleFeeType: 'DEDUCTED', saleFeesConfigured: true },
  { id: 2, name: 'Steam', currency: 'BRL', isActive: true, isPrimary: false, saleFeeType: 'ADDED', saleFeesConfigured: true },
  { id: 3, name: 'CSMoney', currency: 'USD', isActive: true, isPrimary: false, saleFeeType: null, saleFeesConfigured: false },
  { id: 4, name: 'Antiga', currency: 'USD', isActive: false, isPrimary: false, saleFeeType: 'DEDUCTED', saleFeesConfigured: true },
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
    aging: { daysInInventory: 9, agingBucket: 'EM_GIRO' },
    minPrices: [],
    saleProfitUsdCents: null,
    stats: { soldCount: 0, avgDaysToSell: null, avgPurchaseCostUsdCents: null, avgSalePriceUsdCents: null, avgProfitUsdCents: null },
    ...overrides,
  };
}
