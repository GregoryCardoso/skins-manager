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
  app?: string;
  version?: string;
}

// Resposta de GET /backup/info (D175).
export interface BackupInfo {
  dataDir: string;
  backupsDir: string;
  autoBackupKeep: number;
  canOpenFolder: boolean;
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

// Origem da cotação salva e fonte do botão "atualizar cotação" (D162).
export type FxRefreshSource = 'AWESOMEAPI' | 'PTAX';
export type FxRateSource = 'MANUAL' | FxRefreshSource;

export interface Settings {
  usdBrlRate: number | null;
  usdBrlRateUpdatedAt: string | null;
  // Origem da cotação (null = nunca definida), data/hora da cotação na fonte (nula com origem MANUAL) e fonte do botão.
  usdBrlRateSource: FxRateSource | null;
  rateQuotedAt: string | null;
  fxRefreshSource: FxRefreshSource;
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
  updatedAt: string;
}
export interface PreferencesPatch {
  theme?: ThemeChoice;
  language?: Language;
  fxRefreshSource?: FxRefreshSource;
  // Inteiro ou null (volta ao padrão).
  fastTurnoverDays?: number | null;
  slowItemDays?: number | null;
}

// Resposta de POST /settings/fx-rate/refresh (D162): cotação da fonte salva em `fxRefreshSource`.
export interface FxRefreshResult {
  settings: Settings;
  quote: { source: FxRefreshSource; rate: number; buyRate: number | null; sellRate: number; quotedAt: string };
}

// --- Itens, lojas e cotação (4B.2; espelham D49/D72 do backend) ---

export type Currency = 'USD' | 'BRL';
export type Category =
  | 'SKIN' | 'FACA' | 'LUVA' | 'CAIXA' | 'CAPSULA' | 'STICKER' | 'PINGENTE' | 'PERSONAGEM' | 'PASSE_BATALHA' | 'OUTRO';
export type Variant = 'NORMAL' | 'STATTRAK' | 'SOUVENIR';
export type Exterior = 'FN' | 'MW' | 'FT' | 'WW' | 'BS';
export type AcquisitionType = 'GANHEI' | 'COMPRA';
export type ItemStatus = 'EM_ESTOQUE' | 'VENDIDO';
export type AgingBucket = 'RECENTE' | 'EM_GIRO' | 'AGARRADO' | 'EM_TRADE_LOCK' | 'FORA_DE_VENDA';
export type TurnaroundBucket = 'GIRO_RAPIDO' | 'GIRO_NORMAL' | 'DEMOROU_VENDER' | 'SEM_GIRO';
// Item em estoque à venda ou fora de venda (D263); nulo em item vendido.
export type SaleState = 'FOR_SALE' | 'OFF_SALE';
export type WarningCode = 'FEES_NOT_CONFIGURED' | 'FX_NOT_CONFIGURED' | 'PRICE_OVERFLOW';

export interface TradeLock {
  isLocked: boolean;
  remainingMs: number;
  formatted: string;
  tradeUnlockAt: string | null;
}

// Em estoque (D160): `daysForSale` conta da liberação do trade lock (nulo em lock); `daysInInventory` é só informação.
// Vendido: `turnaroundDays` conta da liberação até a venda; `daysHeld` (desde a aquisição) é só informação.
// Fora de venda (D263): `FORA_DE_VENDA` sem dias à venda; vendido fora de venda: `SEM_GIRO` e `turnaroundDays` nulo.
export type Aging =
  | { daysInInventory: number; daysForSale: number | null; agingBucket: AgingBucket }
  | { turnaroundDays: number | null; turnaroundBucket: TurnaroundBucket; daysHeld: number };

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
  // Vendas feitas fora de venda: não entram no tempo médio (D263).
  soldOffSaleCount: number;
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

export interface SaleRelease {
  // Nulo em venda anterior à retenção (liberada).
  releasesAt: string | null;
  isHeld: boolean;
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
  // Snapshot da retenção do saldo na venda (D214); nulo em estoque e em vendas anteriores à v6. Só leitura.
  saleHoldDaysApplied?: number | null;
  tradeLock: TradeLock;
  aging: Aging;
  minPrices: MinPrice[] | null;
  saleProfitUsdCents: number | null;
  saleInfo: SaleInfo | null;
  // Liberação do saldo da venda (D214); nulo em estoque. `isHeld` enquanto o líquido ainda está retido.
  saleRelease: SaleRelease | null;
  // Estado de venda (D265): FOR_SALE/OFF_SALE em estoque; nulo em vendido. As datas só mudam pelos botões da API.
  saleState: SaleState | null;
  offSaleAt: string | null;
  forSaleSince: string | null;
  soldWhileOffSale: boolean;
  stats: ItemStats;
}

export interface ItemListMeta {
  count: number;
  // Contagem das abas, sobre os itens em estoque (com a categoria; sem saleState nem stagnantOnly).
  saleStateCounts: { forSale: number; offSale: number };
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
  saleState?: SaleState;
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
  // Dias de retenção do saldo após a venda (D213); 0 = disponível na hora.
  saleHoldDays: number;
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
  saleHoldDays: number;
  isActive: boolean;
  isPrimary: boolean;
}

export type StorePatchBody = Partial<StoreCreateBody>;

// --- Aportes (D202, D227): valor creditado na moeda da loja (só lojas em USD); R$ pago é opcional e só informativo ---

export interface Deposit {
  id: number;
  storeId: number | null;
  storeName: string | null;
  currency: Currency | null;
  // Valor creditado na loja (USD). Nulo no aporte legado (registrado só em R$ antes da 8.5).
  amountStoreCents: number | null;
  // Valor pago em R$: informativo; nulo quando não informado.
  amountBrlCents: number | null;
  depositedAt: string;
  note: string | null;
  legacy: boolean;
  // Valor em US$ e "≈ R$" calculados pelo backend (nulos sem cotação); estimated = houve conversão R$ -> US$.
  amountUsdCents: number | null;
  approxBrlCents: number | null;
  estimated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DepositList {
  deposits: Deposit[];
  totals: { count: number; legacyCount: number; amountUsdCents: number | null; approxBrlCents: number | null; estimated: boolean };
}

export interface DepositCreateBody {
  storeId: number;
  amountStoreCents: number;
  amountBrlCents?: number | null;
  depositedAt: string;
  note?: string | null;
}

export type DepositPatchBody = Partial<DepositCreateBody>;

// --- Saques (D203, D228): na moeda da loja; o valor recebido em R$ é opcional e só informativo ---

export interface Withdrawal {
  id: number;
  // Saque antigo sem loja: storeId, storeName, currency e amountStoreCents nulos.
  storeId: number | null;
  storeName: string | null;
  currency: Currency | null;
  amountStoreCents: number | null;
  // Taxa paga na moeda da loja; nulo = não informada.
  feeCents: number | null;
  // Líquido na moeda da loja (sacado - taxa; taxa não informada conta 0). Nulo no saque antigo sem loja.
  netStoreCents: number | null;
  // Valor recebido em R$: informativo; nulo quando não informado.
  amountBrlCents: number | null;
  withdrawnAt: string;
  note: string | null;
  legacyWithoutStore: boolean;
  // Líquido em US$ e "≈ R$" calculados pelo backend (nulos sem cotação); estimated = houve conversão para US$.
  amountUsdCents: number | null;
  approxBrlCents: number | null;
  estimated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WithdrawalList {
  withdrawals: Withdrawal[];
  totals: {
    count: number;
    legacyCount: number;
    withoutFeeCount: number;
    netUsdCents: number | null;
    approxBrlCents: number | null;
    estimated: boolean;
  };
}

export interface WithdrawalCreateBody {
  storeId: number;
  amountStoreCents: number;
  feeCents?: number | null;
  amountBrlCents?: number | null;
  withdrawnAt: string;
  note?: string | null;
}

export type WithdrawalPatchBody = Partial<WithdrawalCreateBody>;

export interface FeeSuggestion {
  storeId: number;
  amountStoreCents: number;
  suggestedFeeCents: number | null;
  // 'FEES_NOT_CONFIGURED' quando a loja não tem taxa de saque configurada.
  warningCode: string | null;
}

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

// Resposta de POST /backup/import (D151).
export interface BackupImportResult {
  fileVersion: number;
  schemaVersion: number;
  migrationsApplied: number[];
  preImportBackupFile: string;
  counts: { items: number; stores: number };
}

// --- Saldo das lojas calculado (8.6: D239 a D246) ---

// Só existe a conferência (D253); `legacy` marca o registro antigo (sem cálculo).

// Uma linha do histórico: conferência. `legacy`: conferência migrada ("registro antigo", sem calculado).
export interface StoreBalanceEntry {
  id: number;
  storeId: number;
  storeName: string | null;
  currency: Currency | null;
  kind: 'CHECK';
  balanceCents: number;
  computedCents: number | null;
  differenceCents: number | null;
  adjustmentCents: number | null;
  note: string | null;
  legacy: boolean;
  recordedAt: string;
  createdAt: string;
}

export interface StoreBalanceHistory {
  balances: StoreBalanceEntry[];
}

// Conferência (POST): `adjust` grava o ajuste (nota obrigatória quando há diferença).
export interface StoreBalanceCheckBody {
  storeId: number;
  balanceCents: number;
  recordedAt: string;
  adjust?: boolean;
  note?: string;
}

// Prévia da conferência (GET /store-balances/check-preview): nada é gravado nem calculado no frontend.
export interface StoreBalanceCheckPreview {
  storeId: number;
  currency: Currency;
  recordedAt: string;
  balanceCents: number;
  computedCents: number;
  differenceCents: number;
  differenceUsdCents: number | null;
  differenceApproxBrlCents: number | null;
  estimated: boolean;
}

export interface PendingBalance {
  cents: number;
  count: number;
  nextReleaseAt: string | null;
  // Em US$ (nulo: loja em R$ sem cotação) e "≈ R$" (em loja BRL, o próprio valor nativo); tudo vem do backend (D229).
  usdCents: number | null;
  approxBrlCents: number | null;
  // true se a parcela teve conversão R$ -> US$ (loja BRL com valor > 0).
  estimated: boolean;
}

export interface StoreBalanceBreakdown {
  depositsCents: number;
  purchasesCents: number;
  withdrawalsCents: number;
  salesReleasedCents: number;
  adjustmentsCents: number;
}

export interface StoreBalanceSummary {
  storeId: number;
  storeName: string;
  currency: Currency;
  isActive: boolean;
  allowsWithdrawal: boolean;
  saleHoldDays: number;
  lastCheck: StoreBalanceEntry | null;
  // Dias desde a última conferência (inclusive registro antigo); nulo = nunca conferido.
  daysSinceLastCheck: number | null;
  breakdown: StoreBalanceBreakdown;
  availableCents: number;
  availableUsdCents: number | null;
  availableApproxBrlCents: number | null;
  availableEstimated: boolean;
  negative: boolean;
  pending: PendingBalance;
  ignored: { legacyDeposits: number; currencyMismatch: number };
  estimated: boolean;
  // FX_NOT_CONFIGURED > COMPUTED_BALANCE_NEGATIVE > nulo ("nunca conferido" nunca vira aviso).
  warningCode: string | null;
}

export interface CurrentStoreBalances {
  stores: StoreBalanceSummary[];
  totals: {
    availableUsdCents: number | null;
    pendingUsdCents: number | null;
    nonWithdrawableUsdCents: number | null;
    availableEstimated: boolean;
    pendingEstimated: boolean;
    nonWithdrawableEstimated: boolean;
    approxBrl: {
      available: number | null;
      pending: number | null;
      nonWithdrawable: number | null;
    };
    nextReleaseAt: string | null;
    estimated: boolean;
  };
  usdBrlRate: number | null;
  computedAt: string;
}

// Resumo do lucro real em USD (8.5, D226, D229): tudo calculado no backend; o frontend só exibe.
export interface ProfitWarning {
  source: 'STORE' | 'STOCK' | 'DEPOSITS' | 'WITHDRAWALS';
  storeId: number | null;
  storeName: string | null;
  code: string;
  text: string;
}

export interface ProfitSummary {
  baseCurrency: 'USD';
  depositsUsdCents: number | null;
  withdrawalsNetUsdCents: number | null;
  platformBalanceUsdCents: number | null;
  pendingBalanceUsdCents: number | null;
  nextReleaseAt: string | null;
  stockUsdCents: number | null;
  realProfitUsdCents: number | null;
  // true se qualquer parcela do lucro teve conversão R$ -> US$ ("≈" no valor principal).
  estimated: boolean;
  estimatedParts: {
    deposits: boolean;
    withdrawals: boolean;
    platformBalance: boolean;
    pendingBalance: boolean;
    stock: boolean;
  };
  // "≈ R$" de cada total, calculado no backend (nulo sem cotação).
  approxBrl: {
    deposits: number | null;
    withdrawals: number | null;
    platformBalance: number | null;
    pendingBalance: number | null;
    stock: number | null;
    realProfit: number | null;
  };
  withdrawnVsDeposited: { withdrawnUsdCents: number | null; depositedUsdCents: number | null; ratio: number | null };
  balancesByStore: StoreBalanceSummary[];
  counts: {
    deposits: number;
    legacyDeposits: number;
    withdrawals: number;
    legacyWithdrawals: number;
    withdrawalsWithoutFee: number;
    stockItems: number;
    pendingSales: number;
  };
  warnings: ProfitWarning[];
  fx: { usdBrlRate: number | null; source: FxRateSource | null; updatedAt: string | null; quotedAt: string | null };
  computedAt: string;
}
