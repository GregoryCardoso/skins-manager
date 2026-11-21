// Acesso tipado à ponte do app desktop (D179, D181, D188). No navegador/código-fonte `window.skinsDesktop` não existe.
export type DesktopMode = 'installer' | 'portable' | 'dev';

export interface DesktopAppInfo {
  isDesktop: true;
  version: string;
  mode: DesktopMode;
  electron?: string;
  port?: number | null;
}

export type UpdateStatus = 'disabled' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'busy' | 'error';

export interface UpdateCheckResult {
  mode: DesktopMode;
  currentVersion: string;
  status: UpdateStatus;
  latestVersion?: string;
  // Só com status "downloading".
  percent?: number | null;
}

export interface SkinsDesktopBridge {
  isDesktop: true;
  getAppInfo: () => Promise<DesktopAppInfo>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
}

// ---- Atualização dentro do app (D188) ----
export const UPDATE_PHASES = ['idle', 'available', 'downloading', 'ready', 'installing', 'error', 'portable-available'] as const;
export type UpdatePhase = (typeof UPDATE_PHASES)[number];

export const UPDATE_ACTIONS = ['download', 'later', 'restart', 'installOnQuit', 'dismiss', 'openDownloadPage'] as const;
export type UpdateAction = (typeof UPDATE_ACTIONS)[number];

export interface UpdateErrorInfo {
  kind: 'download' | 'install';
  // Texto puro de até 500 caracteres.
  detail: string;
}

// Estado vindo do processo principal (que é o dono dele). Nunca leva a URL de download.
export interface UpdateState {
  seq: number;
  phase: UpdatePhase;
  mode: DesktopMode | null;
  version: string | null;
  currentVersion: string | null;
  // Markdown cru; o idioma é escolhido aqui no frontend (selectReleaseNotes).
  notes: string;
  percent: number | null;
  error: UpdateErrorInfo | null;
}

export interface UpdateResponse {
  accepted: boolean;
  state: UpdateState;
}

export interface UpdateBridge extends SkinsDesktopBridge {
  getUpdateState: () => Promise<UpdateState>;
  respondToUpdate: (action: UpdateAction, seq: number) => Promise<UpdateResponse>;
  // Devolve a função que cancela a inscrição.
  onUpdateState: (callback: (state: UpdateState) => void) => () => void;
}

// null quando a ponte não existe (navegador comum) ou não tem o formato esperado.
export function getDesktopBridge(
  win: unknown = typeof window === 'undefined' ? undefined : window,
): SkinsDesktopBridge | null {
  if (!win || typeof win !== 'object') return null;
  const bridge = (win as { skinsDesktop?: Partial<SkinsDesktopBridge> }).skinsDesktop;
  if (!bridge || bridge.isDesktop !== true) return null;
  if (typeof bridge.getAppInfo !== 'function' || typeof bridge.checkForUpdates !== 'function') return null;
  return bridge as SkinsDesktopBridge;
}

// null se a ponte não existe ou é de um preload antigo, sem as funções da atualização dentro do app.
export function getUpdateBridge(win?: unknown): UpdateBridge | null {
  const bridge = win === undefined ? getDesktopBridge() : getDesktopBridge(win);
  if (!bridge) return null;
  const candidate = bridge as Partial<UpdateBridge>;
  if (
    typeof candidate.getUpdateState !== 'function' ||
    typeof candidate.respondToUpdate !== 'function' ||
    typeof candidate.onUpdateState !== 'function'
  ) {
    return null;
  }
  return bridge as UpdateBridge;
}

const MODES: readonly string[] = ['installer', 'portable', 'dev'];

// O estado vem de fora da página (IPC): confere o formato antes de usar.
export function isUpdateState(value: unknown): value is UpdateState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.seq !== 'number' || !Number.isSafeInteger(v.seq) || v.seq < 0) return false;
  if (typeof v.phase !== 'string' || !(UPDATE_PHASES as readonly string[]).includes(v.phase)) return false;
  if (v.mode !== null && (typeof v.mode !== 'string' || !MODES.includes(v.mode))) return false;
  if (v.version !== null && typeof v.version !== 'string') return false;
  if (v.currentVersion !== null && typeof v.currentVersion !== 'string') return false;
  if (typeof v.notes !== 'string') return false;
  if (v.percent !== null && (typeof v.percent !== 'number' || !Number.isFinite(v.percent) || v.percent < 0 || v.percent > 100)) {
    return false;
  }
  if (v.error !== null) {
    if (!v.error || typeof v.error !== 'object') return false;
    const e = v.error as Record<string, unknown>;
    if ((e.kind !== 'download' && e.kind !== 'install') || typeof e.detail !== 'string') return false;
  }
  return true;
}

export function isUpdateResponse(value: unknown): value is UpdateResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.accepted === 'boolean' && isUpdateState(v.state);
}
