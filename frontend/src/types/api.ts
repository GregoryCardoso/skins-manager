import type { Language } from '@/i18n/languages';

// Valor gravado no banco. 'SYSTEM' (padrão da migração v2) = "sem preferência": vale o tema do sistema
// operacional como valor inicial. A interface só oferece Claro/Escuro e nunca envia 'SYSTEM' (D112).
export type Theme = 'SYSTEM' | 'LIGHT' | 'DARK';
// Tema escolhido/exibido na interface.
export type ThemeChoice = 'LIGHT' | 'DARK';
// Idiomas disponíveis (registro único em `i18n/languages.ts`, D369).
export type { Language };
// Visão do inventário (D276): agrupada (padrão) ou individual.
export type InventoryView = 'INDIVIDUAL' | 'GROUPED';
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

export type CatalogSource = 'SKINS' | 'STICKERS' | 'CRATES' | 'KEYCHAINS' | 'AGENTS' | 'PATCHES';
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

// Cotação de uma moeda (D369, 11.2): "unidades da moeda por 1 US$". As telas que a usam chegam na 11.3.
export interface FxRateEntry {
  currency: string;
  rate: number | null;
  source: FxRateSource | null;
  refreshSource: FxRefreshSource;
  quotedAt: string | null;
  updatedAt: string;
}
export interface Settings {
  // Moeda de conversão (D369, 11.2) e cotações por moeda; `usdBrlRate*` continuam, derivados do BRL, até o fim da 11.3.
  displayCurrency?: string;
  fxRates?: FxRateEntry[];
  requiredFxCurrencies?: string[];
  usdBrlRate: number | null;
  usdBrlRateUpdatedAt: string | null;
  // Origem da cotação (null = nunca definida), data/hora da cotação na fonte (nula com origem MANUAL) e fonte do botão.
  usdBrlRateSource: FxRateSource | null;
  rateQuotedAt: string | null;
  fxRefreshSource: FxRefreshSource;
  catalogUpdatedAt: string | null;
  // Loja Steam do app (10.4, D363): onde o item comprado no terminal é registrado; nulo = não escolhida.
  steamStoreId: number | null;
  theme: Theme;
  language: Language;
  inventoryView: InventoryView;
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
  displayCurrency?: string;
  theme?: ThemeChoice;
  language?: Language;
  inventoryView?: InventoryView;
  fxRefreshSource?: FxRefreshSource;
  // Inteiro ou null (volta ao padrão).
  fastTurnoverDays?: number | null;
  slowItemDays?: number | null;
}

// Resposta de POST /settings/fx-rate/refresh (D162): cotação da fonte salva em `fxRefreshSource`.
export interface FxRefreshResult {
  settings: Settings;
  // Nulo quando a atualização ao abrir o app foi pulada (`skipped`).
  quote: { source: FxRefreshSource | null; rate: number; buyRate: number | null; sellRate: number; quotedAt: string } | null;
  // Atualização ao abrir o app (D338) que não rodou: já rodou neste processo, cotação digitada à mão ou outra em andamento.
  skipped?: 'ALREADY_RAN' | 'MANUAL_RATE' | 'BUSY';
}

// --- Itens, lojas e cotação (4B.2; espelham D49/D72 do backend) ---

export type Currency = 'USD' | 'BRL';
export type Category =
  | 'SKIN' | 'FACA' | 'LUVA' | 'CAIXA' | 'CAPSULA' | 'STICKER' | 'PINGENTE' | 'PERSONAGEM' | 'PASSE_BATALHA' | 'OUTRO' | 'PATCH';
export type Variant = 'NORMAL' | 'STATTRAK' | 'SOUVENIR';
export type Exterior = 'FN' | 'MW' | 'FT' | 'WW' | 'BS';
// `GERADO` (10.3, D362): unidade criada por uma transformação (não é escolhido no cadastro). `CONSUMIDO`: unidade queimada numa aplicação.
export type AcquisitionType = 'GANHEI' | 'COMPRA' | 'GERADO';
export type ItemStatus = 'EM_ESTOQUE' | 'VENDIDO' | 'CONSUMIDO';
export type AgingBucket = 'RECENTE' | 'EM_GIRO' | 'AGARRADO' | 'EM_TRADE_LOCK' | 'FORA_DE_VENDA' | 'CONSUMIDO';
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
  // Unidades consumidas em transformações (10.3): fora da contagem de unidades e das vendas.
  consumedCount: number;
  // Terminais recusados desta chave (10.4): quantos e o custo efetivo perdido.
  lossCount: number;
  lossUsdCents: number;
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
  // Custo efetivo (10.3): o próprio mais o dos componentes aplicados do estoque.
  purchaseCostUsdCents: number;
  ownCostUsdCents: number;
  inheritedCostUsdCents: number;
  fxUsed: { sale: number | null; purchase: number | null };
  usesRecordedFx: boolean;
  approx: {
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

export type ExternalSource = 'CSFLOAT';

// Componentes aplicados (10.1, D344): stickers colados, chaveiro ou Sticker Slab pendurado (e patches, a partir da 10.3).
export type ComponentKind = 'STICKER' | 'CHARM' | 'STICKER_SLAB' | 'PATCH';
export type ComponentSource = 'MANUAL' | 'CSFLOAT';
export interface ItemComponent {
  id: number;
  kind: ComponentKind;
  catalogId: string | null;
  // Nome canônico em inglês (no slab, "Sticker Slab | <sticker>").
  name: string;
  namePtBr: string | null;
  imageUrl: string | null;
  slot: number | null;
  // Desgaste do sticker, de 0 (intacto) a menos de 1.
  wear: number | null;
  pattern: number | null;
  source: ComponentSource;
  origin: 'CAME_WITH' | 'APPLIED_FROM_STOCK';
  // Aplicado do estoque (10.3, D362): a unidade consumida, a operação, e o que ainda se pode fazer com ele.
  sourceItemId: number | null;
  operationId: number | null;
  undoable: boolean;
  scrapeable: boolean;
  // Pendurado (chaveiro ou slab) de uma arma em estoque: pode ser separado da arma (10.7, D366).
  detachable: boolean;
}
// `charms` conta o pendurado (chaveiro ou Sticker Slab); `patches`, os patches do agente.
export interface ComponentSummary {
  stickers: number;
  charms: number;
  patches: number;
}
// Corpo enviado em `components` (substitui a lista inteira; `[]` limpa; ausente não muda).
export interface ItemComponentInput {
  kind: ComponentKind;
  catalogId: string;
  slot?: number | null;
  wear?: number | null;
  pattern?: number | null;
}

// Entrada do PATCH para um componente aplicado do estoque (10.3, D362): só slot, desgaste e pattern mudam (pelo `id`).
export interface AppliedComponentInput {
  id: number;
  slot?: number | null;
  wear?: number | null;
  pattern?: number | null;
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
  // Liberação real da venda importada do CSFloat (D312); nula nas vendas manuais (valem os dias de retenção). Só leitura.
  saleReleaseAt?: string | null;
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
  // Origem da importação (9.2, D318): 'CSFLOAT' se há vínculo de compra ou venda com a loja; senão nulo.
  externalSource: ExternalSource | null;
  // Componentes aplicados (10.1): só informativos; não mudam custo, giro, lucro nem itemStats.
  components: ItemComponent[];
  componentSummary: ComponentSummary;
  // Custo efetivo em USD (10.3, D362): `purchasePriceCents` nunca muda; o herdado vem dos componentes aplicados do estoque.
  cost: ItemCost;
  // Onde a unidade foi consumida (status CONSUMIDO); senão nulo.
  consumedIn: ItemConsumedIn | null;
  // De onde a unidade veio (abertura ativa): "aberto de <caixa>" / "comprado no terminal" (10.4, D363); senão nulo.
  generatedFrom: ItemGeneratedFrom | null;
  // De onde a unidade veio ao ser separada de uma arma (10.7, D366): "separado de <arma>"; senão nulo.
  detachedFrom: ItemDetachedFrom | null;
  // Em estoque e abrível (caixa, cápsula, pacote, terminal): { kind, quantas chaves compatíveis, nome da chave exigida }; senão nulo.
  openable: ItemOpenable | null;
  // Em estoque e de uma categoria que aceita componentes: mostra "Aplicar do estoque".
  canReceiveComponents: boolean;
  consumedAt?: string | null;
  stats: ItemStats;
  // Valor de mercado (10.5, D364): só informativo; null para vendidas e consumidas. A tela chega na 10.6.
  marketValue?: MarketValue | null;
}

export type MarketValueStatus = 'OK' | 'NO_PRICE' | 'NOT_PRICEABLE';
export type MarketValueReason = 'NO_EXTERIOR' | 'PHASE_REQUIRED' | 'PHASE_UNMAPPED' | 'NOT_PRICEABLE' | 'NOT_FETCHED' | 'NOT_FOUND';
export type NetUnavailableReason = 'NO_INTEGRATION_STORE' | 'FEES_NOT_CONFIGURED' | 'NET_NOT_COMPUTABLE';

export interface MarketValue {
  marketValueUsdCents: number | null;
  parts: { baseCents: number | null; hangingCents: number | null; stickersInfoCents: number; patchesInfoCents: number };
  costUsdCents: number | null;
  costEstimated: boolean;
  unrealizedUsdCents: number | null;
  unrealizedNetUsdCents: number | null;
  netUnavailableReason: NetUnavailableReason | null;
  pricedAt: string | null;
  isStale: boolean;
  status: MarketValueStatus;
  reason: MarketValueReason | null;
  isComplete: boolean;
  missing: string[];
  basis: 'NAME';
  isEstimated: true;
  approx: { marketValue: number | null; unrealized: number | null; unrealizedNet: number | null };
}

// Soma do estoque de um grupo (ou totais do resumo).
export interface MarketValueTotals {
  marketValueUsdCents: number;
  costUsdCents: number;
  unrealizedUsdCents: number;
  unrealizedNetUsdCents: number;
  costEstimated: boolean;
  pricedUnits: number;
  // Unidades com valor e líquido calculado (D365, B3).
  netUnits: number;
  unpricedUnits: number;
  notPriceableUnits: number;
  staleUnits: number;
  unitCount: number;
  isComplete?: boolean;
  approx: { marketValue: number | null; unrealized: number | null; unrealizedNet: number | null };
}

export interface MarketValueSummary {
  configured: boolean;
  inProgress: boolean;
  source: string;
  staleHours: number;
  lastRefreshAt: string | null;
  lastRun: { at: string; status: 'OK' | 'PARTIAL' | 'FAILED'; errorCode: string | null } | null;
  nextAllowedAt: string | null;
  oldestPricedAt: string | null;
  staleKeys: number;
  isEstimated: true;
  totals: MarketValueTotals;
  byState: { forSale: MarketValueTotals; holding: MarketValueTotals };
}

export interface MarketValueRefreshResult {
  requested: number;
  fetched: number;
  updated: number;
  notFound: number;
  notPriceableUnits: number;
  remaining: number;
  budgetUsed: number;
  stoppedBy: string | null;
  retryAt: string | null;
  lastRefreshAt: string | null;
}

// POST /api/market-values/refresh (sempre 200; falhas silenciosas).
export interface MarketValueRefreshResponse {
  skipped: 'ALREADY_RAN' | 'NOT_CONFIGURED' | 'BUSY' | 'COOLDOWN' | null;
  result: MarketValueRefreshResult | null;
  failed: { code: string } | null;
}

export interface ItemCost {
  ownUsdCents: number;
  inheritedUsdCents: number;
  effectiveUsdCents: number;
  estimated: boolean;
  // O efetivo difere do próprio (recebeu custo de componentes ou cedeu parte numa separação).
  hasOperationCost: boolean;
}
export interface ItemConsumedIn {
  operationId: number;
  occurredAt: string;
  // Aplicação (APPLY_COMPONENT) ou abertura (OPEN_CASE / OPEN_TERMINAL). `lost`: terminal recusado (sem item gerado).
  kind: OperationKind | null;
  lost: boolean;
  targetItemId: number | null;
  targetName: string | null;
}
export type OpenContainerKind = 'CASE' | 'CAPSULE' | 'PACKAGE' | 'TERMINAL';
export type OpeningKind = 'CASE' | 'NO_KEY' | 'TERMINAL';
export interface ItemGeneratedFrom {
  operationId: number;
  occurredAt: string;
  kind: OperationKind;
  container: OpenContainerKind | null;
  decision: OpenDecision | null;
  containerName: string | null;
  keyName: string | null;
}
export interface ItemDetachedFrom {
  operationId: number;
  occurredAt: string;
  mode: DetachMode | null;
  weaponItemId: number | null;
  weaponName: string | null;
  pattern: number | null;
}
export interface ItemOpenable {
  kind: OpeningKind;
  compatibleKeys: number;
  // Chaves em estoque que não servem para esta caixa (contagem e até 5 nomes).
  otherKeysInStock: number;
  otherKeyNames: string[];
  requiredKeyName: string | null;
}
export type OpenDecision = 'BUY' | 'DECLINE';

// Abrir caixa, cápsula, pacote e terminal (10.4, D363).
export interface OpenOptionKey {
  itemId: number;
  name: string;
  acquiredAt: string;
  effectiveCostUsdCents: number;
  costEstimated: boolean;
  tradeLocked: boolean;
  offSale: boolean;
}
export interface OpenOptions {
  kind: OpeningKind;
  containerName: string;
  requiredKeyName: string | null;
  keys: OpenOptionKey[];
  otherKeysInStock: number;
  steamStore: { id: number; name: string; currency: Currency } | null;
  defaultFxRate: number | null;
}
// Item obtido: os campos do cadastro, menos os de aquisição (a abertura define). `components`: os que vieram junto.
export type OpenGeneratedBody = Omit<ItemCreateBody, 'acquisitionType' | 'purchaseStoreId' | 'purchasePriceCents' | 'fxRateAtPurchase' | 'acquiredAt'>;
export interface OpenContainerBody {
  keyItemId?: number | null;
  openedAt?: string | null;
  decision?: OpenDecision | null;
  generated?: OpenGeneratedBody | null;
  paidPriceCents?: number | null;
  fxRateAtPurchase?: number | null;
  note?: string | null;
}
export interface OpenContainerResult {
  operation: OperationSummary;
  generatedItem: ItemView | null;
  consumedItemIds: number[];
}

// Aplicar do estoque (10.3, D362).
export interface ApplyCandidate {
  itemId: number;
  kind: ComponentKind;
  catalogId: string;
  name: string;
  namePtBr: string | null;
  imageUrl: string | null;
  acquiredAt: string;
  effectiveCostUsdCents: number;
  costEstimated: boolean;
  tradeLocked: boolean;
  offSale: boolean;
}
export interface ApplyCandidates {
  allowedKinds: ComponentKind[];
  remaining: { stickers: number; hanging: number; patches: number };
  candidates: ApplyCandidate[];
}
export interface ApplyComponentBody {
  sourceItemId: number;
  slot?: number | null;
  wear?: number | null;
  pattern?: number | null;
  appliedAt?: string | null;
}
export type OperationKind = 'APPLY_COMPONENT' | 'DETACH_COMPONENT' | 'SCRAPE_OFF' | 'OPEN_CASE' | 'OPEN_TERMINAL' | 'TRADE_UP';
export type OperationRole = 'CONSUMED' | 'TARGET' | 'CREATED';
export type OperationBlockReason = 'ALREADY_UNDONE' | 'DETACHED' | 'HANGING_OCCUPIED' | 'NOT_LATEST' | 'TARGET_SOLD' | 'TARGET_NOT_IN_STOCK' | 'COMPONENT_LIMIT' | 'COMPONENTS_NOT_ALLOWED';
export interface OperationSummary {
  id: number;
  kind: OperationKind;
  outcome: 'TRANSFERRED' | 'LOST';
  occurredAt: string;
  undoneAt: string | null;
  note: string | null;
}
export interface ItemOperation extends OperationSummary {
  // Perda realizada (terminal recusado ativo), em USD; senão nulo (10.4).
  lossUsdCents?: number | null;
  // Abertura: tipo do recipiente, decisão no terminal e o retrato da unidade gerada que foi desfeita.
  detail?: {
    container: OpenContainerKind | null;
    decision: OpenDecision | null;
    undoneGenerated: { name: string; catalogId: string | null; category: Category; acquisitionType: AcquisitionType; purchasePriceCents?: number; purchaseCurrency?: Currency } | null;
    // Separação (10.7): modo, componente e a divisão (porcentagem em pontos-base e os preços usados).
    detach?: {
      mode: DetachMode | null;
      weaponItemId: number | null;
      component: { kind: ComponentKind | null; name: string | null; pattern: number | null; source: ComponentSource | null };
      share: { hangingShareBp: number; basis: 'MARKET_CACHE' | 'MANUAL'; basePriceCents: number | null; hangingPriceCents: number | null; pricedAt: string | null } | null;
      applyOperationId: number | null;
      returnedItemId: number | null;
    } | null;
  } | null;
  // Aplicação encerrada por uma separação (10.7).
  endedBy?: { operationId: number; occurredAt: string | null } | null;
  role: OperationRole | null;
  counterparts: { itemId: number; name: string | null; role: OperationRole; status: ItemStatus | null }[];
  undoable: boolean;
  undoBlockedReason: OperationBlockReason | null;
}
export interface ApplyComponentResult {
  operation: OperationSummary;
  item: ItemView;
}
export interface UndoOperationResult {
  operation: OperationSummary;
  items: ItemView[];
  // Unidades excluídas pelo desfazer (a gerada de uma abertura).
  removedItemIds?: number[];
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
// Visão agrupada (D274): uma linha por chave do itemStats, com as unidades da aba e dos filtros.
export interface ItemGroupStock {
  // Total do grupo em estoque (9.5.1a): à venda + em trade lock + no holding. É também a QTD do grupo.
  total: number;
  forSale: number;
  tradeLocked: number;
  offSale: number;
  nextUnlockAt: string | null;
}
export interface ItemGroup {
  key: string;
  name: string;
  category: Category;
  variant: Variant | null;
  exterior: Exterior | null;
  phase: string | null;
  catalog: CatalogSummary | null;
  quantity: number;
  totalCostUsdCents: number;
  avgCostUsdCents: number;
  costUsesRecordedFx: boolean;
  approx: { totalCostCents: number; avgCostCents: number } | null;
  // Unidades em estoque do grupo com algum componente (10.1); fora da chave do agrupamento.
  componentUnits: number;
  // Valor de mercado do estoque inteiro do grupo (10.5).
  marketValue?: MarketValueTotals;
  stagnantCount: number;
  stock: ItemGroupStock;
  units: ItemView[];
}
export interface ItemGroupListMeta {
  count: number;
  groupCount: number;
  saleStateCounts: { forSale: number; offSale: number };
  fastTurnoverDays: number;
  slowItemDays: number;
  usdBrlRate: number | null;
  generatedAt: string;
}
// Holding em lote (9.5.1a, D332): por grupo (a chave + quantidade) ou por seleção (ids).
export type BulkSaleStateBody = { groupKey: string; quantity?: number } | { itemIds: number[] };
export interface BulkSaleStateResult {
  movedIds: number[];
  movedCount: number;
  unchangedCount: number;
}

export interface ItemGroupList {
  groups: ItemGroup[];
  meta: ItemGroupListMeta;
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

// Consulta da visão agrupada: sem `status` (só estoque).
export type ItemGroupQuery = Omit<ItemListQuery, 'status'>;

// --- Vendas (4B.4, D124) ---

export interface SalesSummary {
  count: number;
  totalSalePriceUsdCents: number;
  totalNetReceivedUsdCents: number;
  totalPurchaseCostUsdCents: number;
  totalProfitUsdCents: number;
  avgTurnaroundDays: number | null;
  soldWithFxCount: number;
  approx: { totalSalePrice: number | null; totalNetReceived: number | null; totalProfit: number | null };
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
  // É a loja Steam do app (10.4, D363).
  isSteamStore?: boolean;
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
  // Taxa do aporte (D311, 9.6): opcional; nula = não informada (conta 0). O saldo recebe só o creditado.
  feeCents?: number | null;
  // Valor pago em R$: informativo; nulo quando não informado.
  amountBrlCents: number | null;
  depositedAt: string;
  note: string | null;
  legacy: boolean;
  // Valor em US$ e "≈ R$" calculados pelo backend (nulos sem cotação); estimated = houve conversão R$ -> US$.
  // Desde a 9.6 é o "total colocado": creditado + taxa.
  amountUsdCents: number | null;
  approxCents: number | null;
  estimated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DepositList {
  deposits: Deposit[];
  totals: {
    count: number; legacyCount: number; amountUsdCents: number | null; approxCents: number | null; estimated: boolean;
    // Taxas de aporte informadas (US$) e quantos aportes não informaram a taxa (9.6).
    feeCents?: number; feeMissingCount?: number;
  };
}

export interface DepositCreateBody {
  storeId: number;
  amountStoreCents: number;
  feeCents?: number | null;
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
  approxCents: number | null;
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
    approxCents: number | null;
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
  components?: (ItemComponentInput | AppliedComponentInput)[];
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
  differenceApproxCents: number | null;
  estimated: boolean;
}

export interface PendingBalance {
  cents: number;
  count: number;
  nextReleaseAt: string | null;
  // Em US$ (nulo: loja em R$ sem cotação) e "≈ R$" (em loja BRL, o próprio valor nativo); tudo vem do backend (D229).
  usdCents: number | null;
  approxCents: number | null;
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
  availableApproxCents: number | null;
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
    approx: {
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

// Uma parte do estoque pelo custo (8.9): US$ (nulo sem cotação gravada), "≈" se houve conversão, "≈ R$" e unidades.
export interface StockPart {
  usdCents: number | null;
  estimated: boolean;
  approx: number | null;
  count: number;
}

export interface ProfitSummary {
  baseCurrency: 'USD';
  depositsUsdCents: number | null;
  withdrawalsNetUsdCents: number | null;
  platformBalanceUsdCents: number | null;
  pendingBalanceUsdCents: number | null;
  nextReleaseAt: string | null;
  stockUsdCents: number | null;
  // Estoque à venda e em holding (8.9, D283); a soma dos dois é `stockUsdCents`.
  stockBreakdown: {
    forSale: StockPart;
    offSale: StockPart;
  };
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
  approx: {
    deposits: number | null;
    withdrawals: number | null;
    platformBalance: number | null;
    pendingBalance: number | null;
    stock: number | null;
    realProfit: number | null;
  };
  // Perdas por consumo (10.4): terminais recusados; informativo, fora da fórmula do lucro real.
  consumptionLosses?: { usdCents: number; estimated: boolean; count: number; approx: number | null };
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

// --- Integrações (9.1, D316): a chave da API nunca volta completa, só `apiKeyMasked` ---

export interface IntegrationView {
  source: 'CSFLOAT';
  storeId: number | null;
  storeName: string | null;
  storeCurrency: Currency | null;
  storeSaleFeeRate: number | null;
  storeWithdrawalFeeRate: number | null;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  apiKeySavedAt: string | null;
  accountLinked: boolean;
  autoImportOnOpen: boolean;
  autoImportPaused: boolean;
  tradesCutoffAt: string | null;
  lastImportAt: string | null;
  lastImportStatus: 'OK' | 'FAILED' | null;
  lastImportErrorCode: string | null;
  importInProgress: boolean;
  // Importação ao abrir pausada por desfazer (9.5): data do último lote desfeito; nula se a pausa veio da troca de conta.
  lastUndoneAt?: string | null;
  openEntriesCount: number;
  // Valor inicial (editável) da data de corte da primeira importação; nulo se não há sugestão ou o corte já existe.
  suggestedCutoffAt: string | null;
  helpUrl: string;
}

// Comparação das taxas da conta (`/me`) com as da loja no app (D314); `null` = sem como comparar.
export interface FeeCheck {
  accountSaleFeeRate: number | null;
  storeSaleFeeRate: number | null;
  saleFeeMatches: boolean | null;
  accountWithdrawalFeeRate: number | null;
  storeWithdrawalFeeRate: number | null;
  withdrawalFeeMatches: boolean | null;
}

export interface CsfloatTestResult {
  ok: boolean;
  checkedAt: string;
  // Só para mostrar "Conectado como ..."; nunca é gravado.
  username: string | null;
  accountMatches: boolean;
  accountLinkedNow: boolean;
  feeCheck: FeeCheck;
}

export interface CsfloatSwitchAccountResult {
  integration: IntegrationView;
  username: string | null;
}

// --- Importação (9.2, D318): lotes, entradas do resumo e desfazer ---

export type ImportOutcome = 'CREATED' | 'MATCHED' | 'POSSIBLE_DUPLICATE' | 'REVERTED' | 'FAILED' | 'UNKNOWN_STATE';
export type ImportBatchStatus = 'DONE' | 'FAILED' | 'UNDONE';

// Dados neutros do trade (sem dados pessoais); nome traduzido e imagem vêm do catálogo na resposta.
export interface ImportEntryDisplay {
  direction: 'BUY' | 'SELL' | null;
  marketHashName: string | null;
  name: string | null;
  namePtBr: string | null;
  imageUrl: string | null;
  catalogId: string | null;
  category: Category | null;
  variant: Variant | null;
  floatValue: number | null;
  paintSeed: number | null;
  phase: string | null;
  priceCents: number | null;
  currency: Currency;
  date: string | null;
  // Estado bruto do trade (texto curto do CSFloat), usado na mensagem de "estado desconhecido".
  state: string | null;
  // Aporte ou saque do extrato (9.6); nulo nos trades.
  txKind?: 'DEPOSIT' | 'WITHDRAWAL' | null;
  // Venda com taxa diferente da calculada pela loja (FEE_MISMATCH, 9.3): a cobrada pelo CSFloat e a das regras da loja.
  feeCents?: number | null;
  expectedFeeCents?: number | null;
  // Componentes do trade (10.2, D361): nome, slot, desgaste e pattern, como vieram do CSFloat.
  components?: ImportEntryComponent[];
  // O que não foi registrado, com o motivo; vem só nas compras criadas.
  componentWarnings?: ImportComponentWarning[];
}

export interface ImportEntryComponent {
  from: 'STICKER' | 'KEYCHAIN';
  name: string | null;
  slot: number | null;
  wear: number | null;
  pattern: number | null;
}

export type ImportComponentWarningCode =
  | 'COMPONENT_CATALOG_NOT_FOUND' | 'COMPONENT_FULLY_SCRAPED' | 'COMPONENT_LIMIT_EXCEEDED' | 'COMPONENTS_NOT_ALLOWED'
  | 'COMPONENT_MAYBE_APPLIED_FROM_STOCK';

export interface ImportComponentWarning {
  code: ImportComponentWarningCode;
  name: string | null;
  // Só em COMPONENT_MAYBE_APPLIED_FROM_STOCK (10.3, D362): a unidade do estoque que pode ter sido aplicada.
  candidateItemId?: number;
}

export interface ImportEntryView {
  id: number;
  // Ações que valem agora para esta pendência (9.5.1b, D331), calculadas pelo backend.
  allowedActions?: ImportEntryAction[];
  // Tipo do vínculo do lançamento (9.4): CREATED = criado pela importação; MATCHED = lançamento feito à mão e ligado.
  linkKind?: 'CREATED' | 'MATCHED' | null;
  batchId: number;
  outcome: ImportOutcome;
  reasonCode: string | null;
  entityType: 'ITEM_PURCHASE' | 'ITEM_SALE' | 'DEPOSIT' | 'WITHDRAWAL' | null;
  entityId: number | null;
  candidateIds: number[];
  resolution: string | null;
  resolvedAt: string | null;
  display: ImportEntryDisplay;
}

export interface ImportBatchCounts {
  purchasesCreated: number;
  salesCreated: number;
  matched: number;
  known: number;
  beforeCutoff: number;
  notTransferred: number;
  review: number;
  reverted: number;
  failed: number;
  unknownState: number;
  deferredSales: number;
  withoutPurchase: number;
  // Aceitos e revertidos antes de importar (9.4).
  revertedBeforeImport?: number;
  // Aportes e saques do extrato (9.6).
  depositsCreated?: number;
  withdrawalsCreated?: number;
  transfersAwaitingCutoff?: number;
  finesNotImported?: number;
  // Componentes (10.2, D361): compras que ganharam stickers/chaveiro pela varredura e componentes não registrados.
  componentsFilled?: number;
  componentsSkipped?: number;
}

export interface ImportBatchSummary {
  id: number;
  source: 'CSFLOAT';
  trigger: 'MANUAL' | 'AUTO';
  status: ImportBatchStatus;
  startedAt: string;
  finishedAt: string;
  fullScan: boolean;
  cutoffAt: string | null;
  pagesRead: { trades: number; transactions: number };
  warnings: string[];
  counts: ImportBatchCounts;
  unknownTypes: Record<string, number>;
  errorCode: string | null;
  undoneAt: string | null;
  undoable: boolean;
  openEntriesCount: number;
  // O lote mudou a data de corte (9.5.1c, D326).
  cutoffChange?: { from: string; to: string | null } | null;
  // O lote definiu (from nulo) ou mudou a data de corte dos aportes e saques (9.6).
  transactionsCutoffChange?: { from: string | null } | null;
}

// Pré-visualização local da mudança de corte (9.5.1c, D325).
export interface CutoffPreview {
  currentCutoffAt: string;
  newCutoffAt: string;
  direction: 'BACKWARD' | 'FORWARD';
  backward: {
    purchases: { count: number; amountCents: number };
    sales: { count: number; amountCents: number };
    mayHaveUnseen: boolean;
    deposits: { id: number; depositedAt: string; amountStoreCents: number | null }[];
    manualLaunches: { purchases: number; sales: number };
  } | null;
  forward: { importedKept: number; openToClose: number } | null;
  transfers?: TransferCutoffEffect;
}

// Aportes e saques na pré-visualização da data de corte (a única, Revisão 28).
export interface TransferCutoffEffect {
  deposits: { count: number; amountCents: number };
  withdrawals: { count: number; amountCents: number };
  openToClose: number;
  mayHaveUnseen: boolean;
  manualDeposits: { id: number; depositedAt: string; amountStoreCents: number }[];
  manualWithdrawals: number;
}

// Conferência do saldo com o CSFloat (9.7, D313): só leitura.
export interface CsfloatBalanceCheckResult {
  checkedAt: string;
  storeId: number;
  store: { availableCents: number; pendingCents: number };
  csfloat: { balanceCents: number | null; pendingBalanceCents: number | null };
  inTransit: { purchasesCents: number; salesPendingCents: number; openBidsCents: number; count: number };
  expected: { availableCents: number; pendingCents: number };
  difference: { availableCents: number | null; pendingCents: number | null };
  explained: boolean;
  feeCheck: { saleFeeMatches: boolean | null; withdrawalFeeMatches: boolean | null };
}

export interface CsfloatBalanceExplanation {
  checkedAt: string;
  pagesRead: number;
  transactionsRead: number;
  totals: { balanceCents: number; pendingCents: number };
  groups: { reason: string; type: string; count: number; balanceCents: number; pendingCents: number }[];
  unmatched: { type: string; reason: string; createdAt: string; balanceOffsetCents: number; pendingOffsetCents: number }[];
  truncated: boolean;
  sumBalanceCents: number;
  sumPendingCents: number;
  openBidsCents: number;
}

export interface ImportBatchView extends ImportBatchSummary {
  entries: ImportEntryView[];
}

export interface ImportRunBody {
  // MANUAL (padrão) ou AUTO (ao abrir o app, 9.5: sem corte e sem varredura completa).
  trigger?: 'MANUAL' | 'AUTO';
  cutoffAt?: string;
  fullScan?: boolean;
}

// Resposta do run: a manual sempre traz o lote; a automática traz null quando nada novo entrou, ou `skipped` quando não rodou.
export interface ImportRunResult {
  batch: ImportBatchView | null;
  skipped?: 'AUTO_ALREADY_RAN' | 'AUTO_NOT_CONFIGURED' | 'AUTO_PAUSED' | 'BUSY';
}

// PATCH da integração (9.5): a opção "Importar ao abrir o app" e "Reativar" (autoImportPaused: false).
export interface IntegrationPatchBody {
  autoImportOnOpen?: boolean;
  autoImportPaused?: false;
}

export interface ImportBatchList {
  batches: ImportBatchSummary[];
  nextBefore: number | null;
}

export interface UndoPreviewIssue {
  code: string;
  itemId: number | null;
  name: string | null;
  // ENTRY_RESOLVED (9.4): a pendência já resolvida.
  entryId?: number;
}

// Ações de uma pendência (9.4, D301; 9.5.1b, D327 a D331). SPLIT_FROM_ITEM ("Separar de um item que comprei", D321) fica
// reservado: o backend ainda não o oferece nem aceita.
export type ImportEntryAction =
  | 'REMOVE' | 'KEEP' | 'CREATE' | 'LINK' | 'IGNORE' | 'CREATE_PURCHASE' | 'MARK_WON' | 'APPLY_FROM_STOCK' | 'REOPEN' | 'SPLIT_FROM_ITEM';

export interface ImportResolveBody {
  action: ImportEntryAction;
  targetId?: number;
  // "Aplicar e registrar" (APPLY_FROM_STOCK, 10.3): a unidade do aviso e a data da aplicação (até a da venda).
  sourceItemId?: number;
  appliedAt?: string;
  slot?: number | null;
  wear?: number | null;
  pattern?: number | null;
  // "Lançar compra" (CREATE_PURCHASE): só o que o usuário informa; a identidade vem da pendência.
  purchase?: {
    purchaseStoreId: number;
    purchasePriceCents: number;
    fxRateAtPurchase?: number;
    acquiredAt: string;
    tradeUnlockAt: string | null;
  };
  confirmWarnings?: boolean;
  // "Salvar só a compra" (sem o crédito no extrato ainda): a pendência continua aberta.
  purchaseOnly?: boolean;
  // "Foi drop" (MARK_WON): data da aquisição; ausente = a data da venda.
  acquiredAt?: string;
}

export interface ImportBulkResolveBody {
  action: 'MARK_WON' | 'IGNORE' | 'REOPEN';
  entryIds: number[];
  acquiredAt?: string;
}

export interface UndoPreview {
  undoable: boolean;
  reason: 'NOT_LATEST' | 'NOTHING_TO_UNDO' | 'ALREADY_UNDONE' | 'FAILED_BATCH' | null;
  blockers: UndoPreviewIssue[];
  warnings: UndoPreviewIssue[];
  counts: { itemsToDelete: number; linksToRemove: number; salesToUndo: number; transfersToDelete?: number };
}

// Separar o chaveiro ou o Sticker Slab da arma (10.7, D366).
export type DetachMode = 'SPLIT' | 'RETURN';
export type DetachUnavailableReason = 'WEAPON_NO_PRICE' | 'WEAPON_NOT_PRICEABLE' | 'HANGING_NO_PRICE';
export interface DetachSuggestion {
  hangingShareBp: number;
  basePriceCents: number;
  hangingPriceCents: number;
  basePricedAt: string | null;
  hangingPricedAt: string | null;
  pricedAt: string | null;
  isStale: boolean;
}
export interface DetachPreview {
  mode: DetachMode;
  component: { id: number; kind: ComponentKind; catalogId: string | null; name: string; slot: number | null; pattern: number | null; source: ComponentSource; origin: 'CAME_WITH' | 'APPLIED_FROM_STOCK' };
  weapon: { effectiveUsdCents: number | null; estimated: boolean };
  suggestion: DetachSuggestion | null;
  suggestionUnavailableReason: DetachUnavailableReason | null;
  // Valor avaliado do conjunto (arma sem o pendurado + pendurado), pelo cache.
  valuedTotalUsdCents: number | null;
  appliedShareBp?: number | null;
  result: { weaponUsdCents: number; detachedUsdCents: number } | null;
  detached: { category: Category; name: string; catalogId: string | null; returnedItemId?: number };
}
export interface DetachBody {
  detachedAt?: string;
  hangingShareBp?: number;
  tradeUnlockAt?: string;
  note?: string;
}
export interface DetachResult {
  operation: OperationSummary;
  item: ItemView;
  detachedItem: ItemView;
}
