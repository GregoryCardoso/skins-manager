import type {
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
  SaleQuote,
  SellBody,
  SellResult,
  Settings,
  Store,
} from '@/types/api';

const DEFAULT_API_URL = 'http://localhost:3001/api';

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
  const { query, body, timeoutMs = 15000, signal } = options;
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
  if (body !== undefined) {
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

export const listStores = (signal?: AbortSignal) => request<Store[]>('GET', '/stores', { signal });

export const updateFxRate = (usdBrlRate: number) =>
  request<Settings>('PUT', '/settings/fx-rate', { body: { usdBrlRate } });

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
