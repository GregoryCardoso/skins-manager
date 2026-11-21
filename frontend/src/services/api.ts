import type {
  BackupImportResult,
  Category,
  CatalogRefreshResult,
  CatalogSearchResult,
  CatalogStatus,
  ErrorParams,
  HealthStatus,
  ItemCreateBody,
  ItemList,
  ItemListQuery,
  ItemPatchBody,
  ItemView,
  PreferencesPatch,
  PtaxRefreshResult,
  SaleQuote,
  SalesList,
  SalesQuery,
  SellBody,
  SellResult,
  Settings,
  Store,
  StoreCreateBody,
  StorePatchBody,
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
  const { query, body, rawBody, timeoutMs = 15000, signal } = options;
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

export const updateStore = (id: number, body: StorePatchBody) => request<Store>('PATCH', `/stores/${id}`, { body });

export const deleteStore = (id: number) => request<{ id: number }>('DELETE', `/stores/${id}`);

export const updateFxRate = (usdBrlRate: number) =>
  request<Settings>('PUT', '/settings/fx-rate', { body: { usdBrlRate } });

// PTAX de venda do Banco Central (D147): o backend limita a 20 s no total; salva direto. Corpo `{}` JSON obrigatório.
export const refreshPtax = () =>
  request<PtaxRefreshResult>('POST', '/settings/fx-rate/ptax', { body: {}, timeoutMs: 30000 });

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
export async function exportBackup(signal?: AbortSignal): Promise<{ blob: Blob; fileName: string }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 120000);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    let response: Response;
    try {
      response = await fetch(buildUrl('/backup/export'), { method: 'GET', signal: controller.signal });
    } catch {
      if (timedOut) throw new ApiRequestError('TIMEOUT', 'Tempo esgotado', 0);
      if (signal?.aborted) throw new ApiRequestError('ABORTED', 'Requisição cancelada', 0);
      throw new ApiRequestError('NETWORK_ERROR', 'Falha de rede', 0);
    }
    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ApiRequestError('INVALID_RESPONSE', 'Resposta inválida do servidor', response.status);
      }
      const err = (payload as { error?: { code?: unknown; message?: unknown; field?: unknown; params?: unknown } } | null)?.error;
      const code = typeof err?.code === 'string' ? err.code : 'UNKNOWN';
      const message = typeof err?.message === 'string' ? err.message : '';
      throw new ApiRequestError(code, message, response.status, { field: err?.field, params: err?.params });
    }
    let blob: Blob;
    try {
      blob = await response.blob();
    } catch {
      if (timedOut) throw new ApiRequestError('TIMEOUT', 'Tempo esgotado', 0);
      throw new ApiRequestError('NETWORK_ERROR', 'Falha de rede', 0);
    }
    return { blob, fileName: fileNameFromContentDisposition(response.headers.get('Content-Disposition')) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// Envia o arquivo escolhido como corpo binário (Content-Type obrigatório: application/octet-stream).
export const importBackup = (file: Blob) =>
  request<BackupImportResult>('POST', '/backup/import', {
    rawBody: { data: file, contentType: 'application/octet-stream' },
    timeoutMs: 120000,
  });
