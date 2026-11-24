// Estado da importação automática do CSFloat ao abrir o app (10.6, D365 item 3). O `CsfloatAutoImportHost` informa aqui quando dispara e
// quando termina (com sucesso, pulada ou com erro); o `PriceAutoRefreshHost` espera o `DONE` para buscar os preços depois dos trades.
import { useSyncExternalStore } from 'react';

export type AutoImportProgress = 'IDLE' | 'RUNNING' | 'DONE';

let state: AutoImportProgress = 'IDLE';
const listeners = new Set<() => void>();

export function reportAutoImport(next: AutoImportProgress): void {
  if (state === next) return;
  state = next;
  for (const listener of listeners) listener();
}

export function resetAutoImportProgressForTests(): void {
  state = 'IDLE';
}

export function getAutoImportProgress(): AutoImportProgress {
  return state;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useAutoImportProgress(): AutoImportProgress {
  return useSyncExternalStore(subscribe, getAutoImportProgress, getAutoImportProgress);
}
