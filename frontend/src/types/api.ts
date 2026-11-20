export type Theme = 'SYSTEM' | 'LIGHT' | 'DARK';
export type Language = 'pt-BR' | 'en';
export type ResolvedTheme = 'light' | 'dark';

export interface ApiErrorBody {
  code: string;
  message: string;
}
export type ApiEnvelope<T> = { success: true; data: T } | { success: false; error: ApiErrorBody };

export interface HealthStatus {
  status: 'ok';
  timestamp: string;
}

export type CatalogSource = 'SKINS' | 'STICKERS' | 'CRATES' | 'KEYCHAINS' | 'AGENTS';
export interface CatalogStatus {
  catalogUpdatedAt: string | null;
  countsBySource: Record<CatalogSource, number>;
  total: number;
}
export interface CatalogRefreshResult extends CatalogStatus {
  skipped: number;
  linkedLegacyItems: number;
}

export interface Settings {
  usdBrlRate: number | null;
  usdBrlRateUpdatedAt: string | null;
  catalogUpdatedAt: string | null;
  theme: Theme;
  language: Language;
  updatedAt: string | null;
}
export interface PreferencesPatch {
  theme?: Theme;
  language?: Language;
}

// --- Itens, lojas e cotação (4B.2; espelham D49/D72 do backend) ---

export type Currency = 'USD' | 'BRL';
export type Category =
  | 'SKIN' | 'FACA' | 'LUVA' | 'CAIXA' | 'CAPSULA' | 'STICKER' | 'PINGENTE' | 'PERSONAGEM' | 'PASSE_BATALHA' | 'OUTRO';
export type Variant = 'NORMAL' | 'STATTRAK' | 'SOUVENIR';
export type Exterior = 'FN' | 'MW' | 'FT' | 'WW' | 'BS';
export type AcquisitionType = 'GANHEI' | 'COMPRA';
export type ItemStatus = 'EM_ESTOQUE' | 'VENDIDO';
export type AgingBucket = 'RECENTE' | 'EM_GIRO' | 'AGARRADO';
export type TurnaroundBucket = 'GIRO_RAPIDO' | 'GIRO_NORMAL' | 'DEMOROU_VENDER';
export type WarningCode = 'FEES_NOT_CONFIGURED' | 'FX_NOT_CONFIGURED' | 'BELOW_FEE' | 'PRICE_OVERFLOW';

export interface TradeLock {
  isLocked: boolean;
  remainingMs: number;
  formatted: string;
  tradeUnlockAt: string | null;
}

export type Aging =
  | { daysInInventory: number; agingBucket: AgingBucket }
  | { turnaroundDays: number; turnaroundBucket: TurnaroundBucket };

export interface ApproxAmount {
  currency: Currency;
  cents: number;
}

export interface MinPrice {
  storeId: number;
  storeName: string;
  currency: Currency;
  minPriceCents: number | null;
  approx: ApproxAmount | null;
  warning: string | null;
  warningCode: WarningCode | null;
}

export interface CatalogSummary {
  id: string;
  name: string;
  namePtBr: string | null;
  imageUrl: string | null;
  minFloat: number | null;
  maxFloat: number | null;
  hasStattrak: boolean;
  hasSouvenir: boolean;
  phase: string | null;
}

export interface ItemStats {
  soldCount: number;
  avgDaysToSell: number | null;
  avgPurchaseCostUsdCents: number | null;
  avgSalePriceUsdCents: number | null;
  avgProfitUsdCents: number | null;
}

export interface ItemView {
  id: number;
  name: string;
  category: Category;
  catalogId: string | null;
  isLegacy: boolean;
  catalog: CatalogSummary | null;
  variant: Variant | null;
  floatValue: number | null;
  exterior: Exterior | null;
  paintSeed: number | null;
  phase: string | null;
  inspectLink: string | null;
  assetId: string | null;
  acquisitionType: AcquisitionType;
  originDetail: string | null;
  purchaseStoreId: number | null;
  purchasePriceCents: number;
  purchaseCurrency: Currency;
  fxRateAtPurchase: number | null;
  acquiredAt: string;
  tradeUnlockAt: string | null;
  status: ItemStatus;
  saleStoreId: number | null;
  salePriceCents: number | null;
  saleCurrency: Currency | null;
  fxRateAtSale: number | null;
  netReceivedCents: number | null;
  soldAt: string | null;
  tradeLock: TradeLock;
  aging: Aging;
  minPrices: MinPrice[] | null;
  saleProfitUsdCents: number | null;
  stats: ItemStats;
}

export interface ItemListMeta {
  count: number;
  slowItemDays: number;
  usdBrlRate: number | null;
  generatedAt: string;
}
export interface ItemList {
  items: ItemView[];
  meta: ItemListMeta;
}

export interface ItemListQuery {
  status?: ItemStatus;
  category?: Category;
  stagnantOnly?: boolean;
  order: 'asc' | 'desc';
}

export interface Store {
  id: number;
  name: string;
  currency: Currency;
  isActive: boolean;
  isPrimary: boolean;
  saleFeesConfigured: boolean;
}
