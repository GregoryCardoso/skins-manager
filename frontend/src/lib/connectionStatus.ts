// Estado da conexão com o backend (D370, 12.4). Um erro de conexão numa chamada qualquer só dispara a checagem; a tela
// "O app não está respondendo" só aparece depois de DUAS falhas seguidas do /api/health, com um intervalo entre elas. Isso evita
// o falso alarme com o backend ainda subindo (start-app.bat) ou com uma rota lenta que estourou o tempo.
import { useSyncExternalStore } from 'react';
import { ApiRequestError } from '@/services/api';

export type ConnectionPhase = 'UP' | 'CHECKING' | 'DOWN';

export interface ConnectionState {
  phase: ConnectionPhase;
  // Instante (ms) da última checagem concluída; null = ainda não houve.
  lastCheckedAt: number | null;
}

// Os mesmos códigos que as telas de Inventário e Vendas já tratavam como "problema de conexão". ABORTED (cancelado por quem pediu) não conta.
const CONNECTION_CODES = new Set(['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE']);

export function isConnectionError(err: unknown): boolean {
  return err instanceof ApiRequestError && CONNECTION_CODES.has(err.code);
}

// Intervalo entre as duas tentativas do /api/health antes de dar o app como fora do ar.
export const CONNECTION_RETRY_DELAY_MS = 1500;
// Com o app fora do ar, nova checagem automática a cada tanto.
export const CONNECTION_RECHECK_MS = 10000;

// Função pura em relação ao estado: pergunta ao backend até duas vezes. true = respondeu.
export async function checkConnection(
  ping: () => Promise<unknown>,
  { delayMs = CONNECTION_RETRY_DELAY_MS, attempts = 2 }: { delayMs?: number; attempts?: number } = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    try {
      await ping();
      return true;
    } catch {
      // tenta de novo
    }
  }
  return false;
}

let state: ConnectionState = { phase: 'UP', lastCheckedAt: null };
const listeners = new Set<() => void>();

function set(next: ConnectionState): void {
  state = next;
  for (const listener of listeners) listener();
}

// Chamado pelo cache de consultas e pelas mutações quando uma chamada falha por conexão. Só inicia a checagem se está tudo ok.
export function reportConnectionError(): void {
  if (state.phase === 'UP') set({ ...state, phase: 'CHECKING' });
}

export function markUp(now: number = Date.now()): void {
  set({ phase: 'UP', lastCheckedAt: now });
}

export function markDown(now: number = Date.now()): void {
  set({ phase: 'DOWN', lastCheckedAt: now });
}

// Nova checagem com o app já fora do ar: só atualiza a hora da última verificação.
export function touchChecked(now: number = Date.now()): void {
  set({ ...state, lastCheckedAt: now });
}

export function getConnectionState(): ConnectionState {
  return state;
}

export function resetConnectionStatusForTests(): void {
  state = { phase: 'UP', lastCheckedAt: null };
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useConnectionStatus(): ConnectionState {
  return useSyncExternalStore(subscribe, getConnectionState, getConnectionState);
}
