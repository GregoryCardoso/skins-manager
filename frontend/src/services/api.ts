import type {
  BulkSaleStateBody,
  BulkSaleStateResult,
  BackupImportResult,
  BackupInfo,
  Category,
  CatalogRefreshResult,
  CsfloatSwitchAccountResult,
  CutoffPreview,
  CutoffTarget,
  TransferCutoffPreview,
  CsfloatTestResult,
  CatalogSearchResult,
  CatalogStatus,
  CurrentStoreBalances,
  ProfitSummary,
  Deposit,
  DepositCreateBody,
  DepositList,
  DepositPatchBody,
  FeeSuggestion,
  ErrorParams,
  HealthStatus,
  ItemCreateBody,
  ItemList,
  ItemGroupList,
  ItemGroupQuery,
  ItemListQuery,
  ItemPatchBody,
  ImportBatchList,
  ImportBatchView,
  ImportEntryView,
  ImportBulkResolveBody,
  ImportResolveBody,
  ImportRunBody,
  ImportRunResult,
  IntegrationPatchBody,
  IntegrationView,
  ItemView,
  PreferencesPatch,
  FxRefreshResult,
  SaleQuote,
  SalesList,
  SalesQuery,
  SellBody,
  SellResult,
  Settings,
  Store,
  StoreBalanceCheckBody,
  StoreBalanceCheckPreview,
  StoreBalanceEntry,
  StoreBalanceHistory,
  StoreCreateBody,
  StorePatchBody,
  UndoPreview,
  Withdrawal,
  WithdrawalCreateBody,
  WithdrawalList,
  WithdrawalPatchBody,
} from '@/types/api';

// Build de produção: o backend serve a interface na mesma origem (D134); em desenvolvimento a API fica na 3001.
const DEFAULT_API_URL = process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:3001/api';

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  // Campo da API a que o erro se refere e valores para interpolar a mensagem (D113).
  readonly field?: string;
  readonly params?: ErrorParams;

  constructor(code: string, message: string, status = 0, extra: { field?: unknown; params?: unknown } = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    if (typeof extra.field === 'string' && extra.field !== '') this.field = extra.field;
    const params = sanitizeParams(extra.params);
    if (params) this.params = params;
  }
}

// Só mantém valores string/number; qualquer outro tipo é ignorado.
function sanitizeParams(value: unknown): ErrorParams | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: ErrorParams = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item))) out[key] = item;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  // Corpo binário (importação de backup): enviado como está, com o Content-Type informado.
  rawBody?: { data: Blob; contentType: string };
  timeoutMs?: number;
  signal?: AbortSignal;
  // Resposta de sucesso que não é o envelope JSON (download de backup): lida aqui; erros continuam em JSON.
  readOk?: (response: Response) => Promise<unknown>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) params.append(key, String(value));
  }
  const qs = params.toString();
  return `${API_BASE_URL}${path}${qs ? `?${qs}` : ''}`;
}

export async function request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
  const { query, body, rawBody, timeoutMs = 15000, signal, readOk } = options;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  const init: RequestInit = { method, signal: controller.signal };
  if (rawBody !== undefined) {
    init.headers = { 'Content-Type': rawBody.contentType };
    init.body = rawBody.data;
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  try {
    let response: Response;
    try {
      response = await fetch(buildUrl(path, query), init);
    } catch {
      if (timedOut) throw new ApiRequestError('TIMEOUT', 'Tempo esgotado', 0);
      if (signal?.aborted) throw new ApiRequestError('ABORTED', 'Requisição cancelada', 0);
      throw new ApiRequestError('NETWORK_ERROR', 'Falha de rede', 0);
    }

    if (response.status === 204) return undefined as T;

    if (readOk && response.ok) {
      try {
        return (await readOk(response)) as T;
      } catch {
        if (timedOut) throw new ApiRequestError('TIMEOUT', 'Tempo esgotado', 0);
        if (signal?.aborted) throw new ApiRequestError('ABORTED', 'Requisição cancelada', 0);
        throw new ApiRequestError('NETWORK_ERROR', 'Falha de rede', 0);
      }
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (timedOut) throw new ApiRequestError('TIMEOUT', 'Tempo esgotado', 0);
      if (signal?.aborted) throw new ApiRequestError('ABORTED', 'Requisição cancelada', 0);
      throw new ApiRequestError('INVALID_RESPONSE', 'Resposta inválida do servidor', response.status);
    }

    if (payload === null || typeof payload !== 'object' || typeof (payload as { success?: unknown }).success !== 'boolean') {
      throw new ApiRequestError('INVALID_RESPONSE', 'Resposta inválida do servidor', response.status);
    }
    const envelope = payload as { success: boolean; data?: unknown; error?: { code?: unknown; message?: unknown; field?: unknown; params?: unknown } };
    if (envelope.success) return envelope.data as T;

    const code = typeof envelope.error?.code === 'string' ? envelope.error.code : 'UNKNOWN';
    const message = typeof envelope.error?.message === 'string' ? envelope.error.message : '';
    throw new ApiRequestError(code, message, response.status, {
      field: envelope.error?.field,
      params: envelope.error?.params,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export const getHealth = (signal?: AbortSignal) => request<HealthStatus>('GET', '/health', { signal });

export const getSettings = (signal?: AbortSignal) => request<Settings>('GET', '/settings', { signal });

export const updatePreferences = (patch: PreferencesPatch) =>
  request<Settings>('PATCH', '/settings', { body: patch });

export const getCatalogStatus = (signal?: AbortSignal) =>
  request<CatalogStatus>('GET', '/catalog/status', { signal });

// O backend aborta o download em 120 s; o cliente espera um pouco mais.
export const refreshCatalog = () =>
  request<CatalogRefreshResult>('POST', '/catalog/refresh', { body: {}, timeoutMs: 150000 });

// Sempre ordena por idade (D105); `order` só é enviado junto com `sortBy`; `stagnantOnly` só quando verdadeiro.
export const listItems = (query: ItemListQuery, signal?: AbortSignal) =>
  request<ItemList>('GET', '/items', {
    signal,
    query: {
      status: query.status,
      category: query.category,
      stagnantOnly: query.stagnantOnly ? 'true' : undefined,
      saleState: query.saleState,
      sortBy: 'age',
      order: query.order,
    },
  });

// Visão agrupada (D274): só estoque; sempre ordena por idade.
export const listItemGroups = (query: ItemGroupQuery, signal?: AbortSignal) =>
  request<ItemGroupList>('GET', '/items/groups', {
    signal,
    query: {
      category: query.category,
      stagnantOnly: query.stagnantOnly ? 'true' : undefined,
      saleState: query.saleState,
      sortBy: 'age',
      order: query.order,
    },
  });

// `order` só é enviado junto com `sortBy` (que aqui é sempre enviado).
export const listSales = (query: SalesQuery, signal?: AbortSignal) =>
  request<SalesList>('GET', '/items/sales', {
    signal,
    query: {
      saleStoreId: query.saleStoreId,
      soldFrom: query.soldFrom,
      soldTo: query.soldTo,
      sortBy: query.sortBy,
      order: query.order,
    },
  });

export const listStores = (signal?: AbortSignal) => request<Store[]>('GET', '/stores', { signal });

export const getStore = (id: number, signal?: AbortSignal) => request<Store>('GET', `/stores/${id}`, { signal });

export const createStore = (body: StoreCreateBody) => request<Store>('POST', '/stores', { body });

// Holding em lote (9.5.1a): tudo ou nada.
export const bulkMarkOffSale = (body: BulkSaleStateBody) => request<BulkSaleStateResult>('POST', '/items/bulk/off-sale', { body });
export const bulkMarkForSale = (body: BulkSaleStateBody) => request<BulkSaleStateResult>('POST', '/items/bulk/for-sale', { body });

export const updateStore = (id: number, body: StorePatchBody) => request<Store>('PATCH', `/stores/${id}`, { body });

export const deleteStore = (id: number) => request<{ id: number }>('DELETE', `/stores/${id}`);

// Aportes (D202): lista com totais calculados no backend; o frontend não soma nada.
export const listDeposits = (signal?: AbortSignal) => request<DepositList>('GET', '/deposits', { signal });

export const createDeposit = (body: DepositCreateBody) => request<Deposit>('POST', '/deposits', { body });

export const updateDeposit = (id: number, body: DepositPatchBody) => request<Deposit>('PATCH', `/deposits/${id}`, { body });

export const deleteDeposit = (id: number) => request<{ id: number }>('DELETE', `/deposits/${id}`);

// Saques (D203): a sugestão de taxa só pré-preenche o formulário; nada é calculado no frontend.
export const listWithdrawals = (signal?: AbortSignal) => request<WithdrawalList>('GET', '/withdrawals', { signal });

export const getWithdrawalFeeSuggestion = (storeId: number, amountStoreCents: number, signal?: AbortSignal) =>
  request<FeeSuggestion>('GET', '/withdrawals/fee-suggestion', { signal, query: { storeId, amountStoreCents } });

export const createWithdrawal = (body: WithdrawalCreateBody) => request<Withdrawal>('POST', '/withdrawals', { body });

export const updateWithdrawal = (id: number, body: WithdrawalPatchBody) =>
  request<Withdrawal>('PATCH', `/withdrawals/${id}`, { body });

export const deleteWithdrawal = (id: number) => request<{ id: number }>('DELETE', `/withdrawals/${id}`);

// Saldo das lojas calculado (8.6, D246, Revisão 23): o backend calcula tudo; o frontend só envia conferências.
export const getCurrentStoreBalances = (signal?: AbortSignal) =>
  request<CurrentStoreBalances>('GET', '/store-balances/current', { signal });

export const listStoreBalances = (storeId: number, signal?: AbortSignal) =>
  request<StoreBalanceHistory>('GET', '/store-balances', { signal, query: { storeId } });

// Prévia da conferência: calculado e diferença na data informada, sem gravar nada.
export const getStoreBalanceCheckPreview = (
  query: { storeId: number; balanceCents: number; recordedAt: string },
  signal?: AbortSignal,
) => request<StoreBalanceCheckPreview>('GET', '/store-balances/check-preview', { signal, query });

export const createStoreBalanceCheck = (body: StoreBalanceCheckBody) =>
  request<StoreBalanceEntry>('POST', '/store-balances', { body });

export const deleteStoreBalanceEntry = (id: number) => request<{ id: number }>('DELETE', `/store-balances/${id}`);

export const updateFxRate = (usdBrlRate: number) =>
  request<Settings>('PUT', '/settings/fx-rate', { body: { usdBrlRate } });

// Atualiza a cotação pela fonte salva (D162; AwesomeAPI ou PTAX, até 20 s no backend); salva direto.
// Corpo `{}` JSON obrigatório.
export const refreshFxRate = () =>
  request<FxRefreshResult>('POST', '/settings/fx-rate/refresh', { body: {}, timeoutMs: 30000 });

// "Não está à venda" e "Colocar à venda" (D265): a data é a do servidor; o corpo é `{}` (JSON obrigatório).
export const markItemOffSale = (id: number) => request<{ item: ItemView }>('POST', `/items/${id}/off-sale`, { body: {} });

export const markItemForSale = (id: number) => request<{ item: ItemView }>('POST', `/items/${id}/for-sale`, { body: {} });

export const getItem = (id: number, signal?: AbortSignal) => request<ItemView>('GET', `/items/${id}`, { signal });

export const createItem = (body: ItemCreateBody) => request<ItemView>('POST', '/items', { body });

export const updateItem = (id: number, body: ItemPatchBody) => request<ItemView>('PATCH', `/items/${id}`, { body });

export const deleteItem = (id: number) => request<{ id: number }>('DELETE', `/items/${id}`);

export const sellItem = (id: number, body: SellBody) => request<SellResult>('POST', `/items/${id}/sell`, { body });

export const unsellItem = (id: number) => request<ItemView>('POST', `/items/${id}/unsell`, { body: {} });

// Prévia do líquido da venda (D122): só calcula, não grava.
export const getSaleQuote = (storeId: number, salePriceCents: number, signal?: AbortSignal) =>
  request<SaleQuote>('GET', `/stores/${storeId}/sale-quote`, { signal, query: { salePriceCents } });

export const MIN_CATALOG_QUERY_LENGTH = 2;

// Busca com menos de 2 caracteres não chama a API (o backend recusaria).
export async function searchCatalog(
  q: string,
  options: { category?: Category; limit?: number; signal?: AbortSignal } = {},
): Promise<CatalogSearchResult> {
  const text = q.trim();
  if (text.length < MIN_CATALOG_QUERY_LENGTH) {
    return { items: [], meta: { catalogUpdatedAt: null, total: 0 } };
  }
  return request<CatalogSearchResult>('GET', '/catalog/search', {
    signal: options.signal,
    query: { q: text, category: options.category, limit: options.limit },
  });
}

// --- Backup (D150, D151) ----------------------------------------------------------------------

const DEFAULT_BACKUP_FILE_NAME = 'skins-manager-backup.sqlite';

// Nome do arquivo no cabeçalho Content-Disposition (aceita filename*=UTF-8''...); só o nome base, sem caminho.
export function fileNameFromContentDisposition(header: string | null | undefined): string {
  if (!header) return DEFAULT_BACKUP_FILE_NAME;
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i.exec(header);
  let raw = extended ? extended[1].trim() : plain ? (plain[1] ?? plain[2] ?? '').trim() : '';
  if (extended) {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      raw = '';
    }
  }
  const base = raw.split(/[\\/]/).pop() ?? '';
  return base.trim() === '' ? DEFAULT_BACKUP_FILE_NAME : base.trim();
}

// Baixa o backup como Blob (erros continuam em JSON, então o corpo só é lido como arquivo no sucesso).
export const exportBackup = (signal?: AbortSignal) =>
  request<{ blob: Blob; fileName: string }>('GET', '/backup/export', {
    signal,
    timeoutMs: 120000,
    readOk: async (response) => ({
      blob: await response.blob(),
      fileName: fileNameFromContentDisposition(response.headers.get('Content-Disposition')),
    }),
  });

// Envia o arquivo escolhido como corpo binário (Content-Type obrigatório: application/octet-stream).
export const importBackup = (file: Blob) =>
  request<BackupImportResult>('POST', '/backup/import', {
    rawBody: { data: file, contentType: 'application/octet-stream' },
    timeoutMs: 120000,
  });

// Caminho das pastas de dados e de backups (D175).
export const getBackupInfo = (signal?: AbortSignal) => request<BackupInfo>('GET', '/backup/info', { signal });

// Abre a pasta de backups no Explorer; o servidor não aceita nenhum caminho (corpo `{}`).
export const openBackupsFolder = () => request<{ path: string }>('POST', '/backup/open-folder', { body: {} });

// Resumo do lucro real (D205): total acumulado.
export const getProfitSummary = (signal?: AbortSignal) => request<ProfitSummary>('GET', '/profit/summary', { signal });

// --- Integrações (9.1, D316) ----------------------------------------------------------------------

export const getCsfloatIntegration = (signal?: AbortSignal) =>
  request<IntegrationView>('GET', '/integrations/csfloat', { signal });

// A chave só trafega neste PUT; quem chama não a guarda em estado nem no cache de consultas.
export const saveCsfloatApiKey = (apiKey: string) =>
  request<IntegrationView>('PUT', '/integrations/csfloat/api-key', { body: { apiKey } });

export const removeCsfloatApiKey = () => request<IntegrationView>('DELETE', '/integrations/csfloat/api-key');

// O servidor espera até 20 s pelo CSFloat; o cliente espera um pouco mais.
export const testCsfloatConnection = () =>
  request<CsfloatTestResult>('POST', '/integrations/csfloat/test', { body: {}, timeoutMs: 30000 });

export const switchCsfloatAccount = () =>
  request<CsfloatSwitchAccountResult>('POST', '/integrations/csfloat/switch-account', { body: { confirm: true }, timeoutMs: 30000 });

// --- Importação (9.2, D318) ------------------------------------------------------------------------

// O servidor espera até 120 s pelo CSFloat (muitas páginas); o cliente espera um pouco mais.
export const runCsfloatImport = (body: ImportRunBody = {}) =>
  request<ImportRunResult>('POST', '/imports/csfloat/run', { body, timeoutMs: 150000 });

// Data de corte (9.5.1c, D325): pré-visualização local (sem rede) e a mudança, que roda uma importação com varredura completa.
export const previewCutoffChange = (cutoffAt: string, signal?: AbortSignal) =>
  request<CutoffPreview>('GET', '/imports/csfloat/cutoff-preview', { signal, query: { cutoffAt } });
// Data de corte dos aportes e saques (9.6): a mesma rota, com target=TRANSACTIONS.
export const previewTransferCutoff = (cutoffAt: string, signal?: AbortSignal) =>
  request<TransferCutoffPreview>('GET', '/imports/csfloat/cutoff-preview', { signal, query: { cutoffAt, target: 'TRANSACTIONS' } });
export const changeCutoff = (cutoffAt: string, target: CutoffTarget = 'TRADES') =>
  request<ImportRunResult>('POST', '/imports/csfloat/change-cutoff', { body: { cutoffAt, confirm: true, target }, timeoutMs: 150000 });

// Opção "Importar ao abrir o app" e "Reativar" (9.5).
export const updateCsfloatIntegration = (body: IntegrationPatchBody) =>
  request<IntegrationView>('PATCH', '/integrations/csfloat', { body });

export const listImportBatches = (query: { limit?: number; before?: number | null } = {}, signal?: AbortSignal) =>
  request<ImportBatchList>('GET', '/imports/batches', { signal, query: { limit: query.limit, before: query.before } });

export const getImportBatch = (id: number, signal?: AbortSignal) => request<ImportBatchView>('GET', `/imports/batches/${id}`, { signal });

export const getUndoPreview = (id: number, signal?: AbortSignal) =>
  request<UndoPreview>('GET', `/imports/batches/${id}/undo-preview`, { signal });

export const undoImportBatch = (id: number, confirmWarnings: boolean) =>
  request<ImportBatchView>('POST', `/imports/batches/${id}/undo`, { body: { confirmWarnings } });

// Resolve uma pendência (9.4): remover/manter (trade revertido), criar/ligar/ignorar (possível duplicado), ignorar (falha).
export const resolveImportEntry = (id: number, body: ImportResolveBody) =>
  request<ImportEntryView>('POST', `/imports/entries/${id}/resolve`, { body });

// "Voltar para pendências" de uma ignorada (9.5.1b, D329).
export const reopenImportEntry = (id: number) => request<ImportEntryView>('POST', `/imports/entries/${id}/reopen`, { body: {} });

// Ações em lote nas pendências (9.5.1b, D330): tudo ou nada.
export const bulkResolveImportEntries = (body: ImportBulkResolveBody) =>
  request<{ entries: ImportEntryView[]; count: number }>('POST', '/imports/entries/bulk-resolve', { body });

// Ignoradas que podem voltar para as pendências (9.5.1b, D329).
export const listIgnoredImportEntries = (signal?: AbortSignal) =>
  request<{ entries: ImportEntryView[] }>('GET', '/imports/entries', { signal, query: { ignored: 'true' } });

export const listOpenImportEntries = (signal?: AbortSignal) =>
  request<{ entries: ImportEntryView[] }>('GET', '/imports/entries', { signal, query: { open: 'true' } });
