import type {
  CatalogRefreshResult,
  CatalogStatus,
  HealthStatus,
  PreferencesPatch,
  Settings,
} from '@/types/api';

const DEFAULT_API_URL = 'http://localhost:3001/api';

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
  }
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
    const envelope = payload as { success: boolean; data?: unknown; error?: { code?: unknown; message?: unknown } };
    if (envelope.success) return envelope.data as T;

    const code = typeof envelope.error?.code === 'string' ? envelope.error.code : 'UNKNOWN';
    const message = typeof envelope.error?.message === 'string' ? envelope.error.message : '';
    throw new ApiRequestError(code, message, response.status);
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
