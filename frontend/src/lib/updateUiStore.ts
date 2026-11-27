import type { UpdateState } from './desktop';

// Ponte entre o DesktopUpdateHost (dono do estado exibido) e o selo do menu (12.10, parte 3): o host publica o estado e se
// o modal está escondido; o selo lê e, ao ser clicado, pede para reabrir. Fora do React (módulo), para o host continuar
// sem contexto e o selo funcionar em qualquer ponto do layout.
export interface UpdateUiSnapshot {
  state: UpdateState | null;
  hidden: boolean;
}

const EMPTY: UpdateUiSnapshot = { state: null, hidden: false };
let snapshot: UpdateUiSnapshot = EMPTY;
const listeners = new Set<() => void>();
const reopenListeners = new Set<() => void>();

export function publishUpdateUi(next: UpdateUiSnapshot): void {
  if (snapshot.state === next.state && snapshot.hidden === next.hidden) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function clearUpdateUi(): void {
  publishUpdateUi(EMPTY);
}

export function getUpdateUiSnapshot(): UpdateUiSnapshot {
  return snapshot;
}

export function getServerUpdateUiSnapshot(): UpdateUiSnapshot {
  return EMPTY;
}

export function subscribeUpdateUi(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Pedido de reabrir o modal escondido (o host é quem limpa o marcador de "escondido").
export function requestUpdateReopen(): void {
  reopenListeners.forEach((listener) => listener());
}

export function onUpdateReopen(listener: () => void): () => void {
  reopenListeners.add(listener);
  return () => {
    reopenListeners.delete(listener);
  };
}

// Fases em que o selo aparece.
export function badgePhase(state: UpdateState | null): state is UpdateState {
  return state !== null && ['available', 'portable-available', 'downloading', 'ready'].includes(state.phase);
}
