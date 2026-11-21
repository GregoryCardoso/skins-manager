// Acesso tipado à ponte do app desktop (D179, D181). No navegador/código-fonte `window.skinsDesktop` não existe.
export type DesktopMode = 'installer' | 'portable' | 'dev';

export interface DesktopAppInfo {
  isDesktop: true;
  version: string;
  mode: DesktopMode;
  electron?: string;
  port?: number | null;
}

export type UpdateStatus = 'disabled' | 'up-to-date' | 'available' | 'ready' | 'busy' | 'error';

export interface UpdateCheckResult {
  mode: DesktopMode;
  currentVersion: string;
  status: UpdateStatus;
  latestVersion?: string;
}

export interface SkinsDesktopBridge {
  isDesktop: true;
  getAppInfo: () => Promise<DesktopAppInfo>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
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
