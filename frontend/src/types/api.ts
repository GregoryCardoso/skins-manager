// Valor gravado no banco. 'SYSTEM' (padrão da migração v2) = "sem preferência": vale o tema do sistema
// operacional como valor inicial. A interface só oferece Claro/Escuro e nunca envia 'SYSTEM' (D112).
export type Theme = 'SYSTEM' | 'LIGHT' | 'DARK';
// Tema escolhido/exibido na interface.
export type ThemeChoice = 'LIGHT' | 'DARK';
export type Language = 'pt-BR' | 'en';
export type ResolvedTheme = 'light' | 'dark';

export type ErrorParams = Record<string, string | number>;

export interface ApiErrorBody {
  code: string;
  message: string;
  field?: string;
  params?: ErrorParams;
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

export type FxRateSource = 'MANUAL' | 'PTAX';

export interface Settings {
  usdBrlRate: number | null;
  usdBrlRateUpdatedAt: string | null;
  // Origem da cotação (null = nunca definida) e data da PTAX (só com origem PTAX).
  usdBrlRateSource: FxRateSource | null;
  ptaxQuotedAt: string | null;
  catalogUpdatedAt: string | null;
  theme: Theme;
  language: Language;
  // Limites de giro (D159): valores salvos (null = padrão), efetivos e padrões.
  fastTurnoverDaysCustom: number | null;
  slowItemDaysCustom: number | null;
  fastTurnoverDays: number;
  slowItemDays: number;
  fastTurnoverDaysDefault: number;
  slowItemDaysDefault: number;
  agingThresholdsAdjusted: boolean;
  updatedAt: string | null;
}
export interface PreferencesPatch {
  theme?: ThemeChoice;
  language?: Language;
  // Inteiro ou null (volta ao padrão).
  fastTurnoverDays?: number | null;
  slowItemDays?: number | null;
}

// Resposta de POST /settings/fx-rate/ptax (D147): PTAX de venda do dia útil mais recente com cotação.
export interface PtaxRefreshResult {
  settings: Settings;
  ptax: { rate: number; buyRate: number | null; sellRate: number; quotedAt: string; quoteDate: string };
}

// --- Itens, lojas e cotação (4B.2; espelham D49/D72 do backend) ---

export type Currency = 'USD' | 'BRL';
export type Category =
  | 'SKIN' | 'FACA' | 'LUVA' | 'CAIXA' | 'CAPSULA' | 'STICKER' | 'PINGENTE' | 'PERSONAGEM' | 'PASSE_BATALHA' | 'OUTRO';
export type Variant = 'NORMAL' | 'STATTRAK' | 'SOUVENIR';
export type Exterior = 'FN' | 'MW' | 'FT' | 'WW' | 'BS';
export type AcquisitionType = 'GANHEI' | 'COMPRA';
export type ItemStatus = 'EM_ESTOQUE' | 'VENDIDO';
export type AgingBucket = 'RECENTE' | 'EM_GIRO' | 'AGARRADO' | 'EM_TRADE_LOCK';
export type TurnaroundBucket = 'GIRO_RAPIDO' | 'GIRO_NORMAL' | 'DEMOROU_VENDER';
export type WarningCode = 'FEES_NOT_CONFIGURED' | 'FX_NOT_CONFIGURED' | 'BELOW_FEE' | 'PRICE_OVERFLOW';

export interface TradeLock {
  isLocked: boolean;
  remainingMs: number;
  formatted: string;
  tradeUnlockAt: string | null;
}

// Em estoque (D160): `daysForSale` conta da liberação do trade lock (nulo em lock); `daysInInventory` é só informação.
// Vendido: `turnaroundDays` conta da liberação até a venda; `daysHeld` (desde a aquisição) é só informação.
export type Aging =
  | { daysInInventory: number; daysForSale: number | null; agingBucket: AgingBucket }
  | { turnaroundDays: number; turnaroundBucket: TurnaroundBucket; daysHeld: number };

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
  unitCount: number;
  soldWithFxCount: number;
  soldCount: number;
  avgDaysToSell: number | null;
  avgPurchaseCostUsdCents: number | null;
  avgSalePriceUsdCents: number | null;
  avgProfitUsdCents: number | null;
}

// Valores da venda em USD (cotação gravada de cada lado) e "≈ R$" pela cotação atual (D125).
export interface SaleInfo {
  salePriceUsdCents: number;
  netReceivedUsdCents: number;
  purchaseCostUsdCents: number;
  fxUsed: { sale: number | null; purchase: number | null };
  usesRecordedFx: boolean;
  approxBrl: {
    salePrice: number | null;
    netReceived: number | null;
    purchaseCost: number | null;
    profit: number | null;
  };
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
  netReceivedManual: boolean;
  soldAt: string | null;
  tradeLock: TradeLock;
  aging: Aging;
  minPrices: MinPrice[] | null;
  saleProfitUsdCents: number | null;
  saleInfo: SaleInfo | null;
  stats: ItemStats;
}

export interface ItemListMeta {
  count: number;
  fastTurnoverDays: number;
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

// --- Vendas (4B.4, D124) ---

export interface SalesSummary {
  count: number;
  totalSalePriceUsdCents: number;
  totalNetReceivedUsdCents: number;
  totalPurchaseCostUsdCents: number;
  totalProfitUsdCents: number;
  avgTurnaroundDays: number | null;
  soldWithFxCount: number;
  approxBrl: { totalSalePrice: number | null; totalNetReceived: number | null; totalProfit: number | null };
}

export interface SalesList {
  items: ItemView[];
  summary: SalesSummary;
  meta: ItemListMeta & { soldFrom: string | null; soldTo: string | null };
}

export type SalesSortBy = 'soldAt' | 'turnaround';

export interface SalesQuery {
  saleStoreId?: number;
  soldFrom?: string;
  soldTo?: string;
  sortBy: SalesSortBy;
  order: 'asc' | 'desc';
}

export type SaleFeeType = 'DEDUCTED' | 'ADDED';

export type SaleFeeRounding = 'CEIL' | 'ROUND' | 'FLOOR';

// Loja completa (D156). Taxas percentuais em fração (0.025 = 2,5%); valores em centavos da moeda da loja.
export interface Store {
  id: number;
  name: string;
  currency: Currency;
  isActive: boolean;
  isPrimary: boolean;
  saleFeeType: SaleFeeType | null;
  saleFeeRate: number | null;
  saleFeeRounding: SaleFeeRounding;
  saleMinFeeCents: number | null;
  saleFixedFeeCents: number;
  allowsWithdrawal: boolean;
  withdrawalFeeRate: number | null;
  withdrawalFixedFeeCents: number;
  createdAt: string;
  updatedAt: string;
  saleFeesConfigured: boolean;
  // Loja já usada em itens, aportes, saques ou saldos: a moeda fica travada e ela não pode ser excluída.
  inUse: boolean;
}

export interface StoreCreateBody {
  name: string;
  currency: Currency;
  saleFeeType: SaleFeeType | null;
  saleFeeRate: number | null;
  saleFeeRounding: SaleFeeRounding;
  saleMinFeeCents: number | null;
  saleFixedFeeCents: number;
  allowsWithdrawal: boolean;
  withdrawalFeeRate: number | null;
  withdrawalFixedFeeCents: number;
  isActive: boolean;
  isPrimary: boolean;
}

export type StorePatchBody = Partial<StoreCreateBody>;

// --- Catálogo (busca do formulário, D115) ---

export interface CatalogItem {
  id: string;
  source: CatalogSource;
  category: Category;
  name: string;
  namePtBr: string | null;
  imageUrl: string | null;
  minFloat: number | null;
  maxFloat: number | null;
  hasStattrak: boolean;
  hasSouvenir: boolean;
  phase: string | null;
  rarity: string | null;
}

export interface CatalogSearchResult {
  items: CatalogItem[];
  meta: { catalogUpdatedAt: string | null; total: number };
}

// --- Corpos de cadastro, edição e venda (D116, D117, D122) ---

// Só os campos presentes são enviados (o backend distingue ausente de null).
export interface ItemCreateBody {
  catalogId?: string;
  name?: string;
  category?: Category;
  acquisitionType: AcquisitionType;
  variant?: Variant | null;
  floatValue?: number | null;
  exterior?: Exterior | null;
  paintSeed?: number | null;
  phase?: string | null;
  inspectLink?: string | null;
  assetId?: string | null;
  originDetail?: string | null;
  purchaseStoreId?: number | null;
  purchasePriceCents?: number;
  fxRateAtPurchase?: number | null;
  acquiredAt?: string;
  tradeUnlockAt?: string | null;
}
export type ItemPatchBody = Partial<ItemCreateBody>;

export interface SellBody {
  saleStoreId: number;
  salePriceCents: number;
  soldAt: string;
  fxRateAtSale?: number;
  netReceivedCents?: number;
}

export interface SellResult {
  item: ItemView;
  sale: {
    netReceivedCents: number;
    feeCents: number;
    saleProfitUsdCents: number | null;
    netReceivedManual: boolean;
  };
}

export interface SaleQuote {
  storeId: number;
  currency: Currency;
  salePriceCents: number;
  feeCents: number;
  netReceivedCents: number;
}
