// O que aconteceu com as buscas automáticas ao abrir o app (cotação, D338, e importação do CSFloat, 9.5). As duas correm ao mesmo
// tempo e cada uma informa aqui o resultado; a faixa "Sem conexão" (12.4) junta as que falharam por falta de internet num só aviso.
import { useSyncExternalStore } from 'react';

export type StartupTask = 'fx' | 'csfloat';
export type StartupOutcome = 'OK' | 'OFFLINE';

// Códigos que significam "não deu para falar com a fonte" (internet fora ou lenta demais), e não um erro da fonte.
const OFFLINE_CODES = new Set(['FX_FETCH_FAILED', 'IMPORT_SOURCE_UNREACHABLE']);

// Função pura: a falha foi falta de conexão? `online` é o navigator.onLine (false = o sistema diz que está sem rede).
export function isOfflineFailure(code: string | null | undefined, online = true): boolean {
  if (!online) return true;
  return typeof code === 'string' && OFFLINE_CODES.has(code);
}

// Função pura: as tarefas que falharam por falta de conexão, na ordem fixa (cotação, CSFloat).
export function offlineTasks(state: Partial<Record<StartupTask, StartupOutcome>>): StartupTask[] {
  return (['fx', 'csfloat'] as const).filter((task) => state[task] === 'OFFLINE');
}

let state: Partial<Record<StartupTask, StartupOutcome>> = {};
const listeners = new Set<() => void>();

export function reportStartup(task: StartupTask, outcome: StartupOutcome): void {
  if (state[task] === outcome) return;
  state = { ...state, [task]: outcome };
  for (const listener of listeners) listener();
}

export function resetStartupStatusForTests(): void {
  state = {};
  retries.clear();
}

// "Tentar de novo" da faixa de início sem internet (12.4): cada tarefa registra a função que refaz a mesma chamada (com o gatilho
// manual, o dos botões das Configurações, porque o automático só vale uma vez por abertura). A função informa o resultado por
// reportStartup. Devolve o cancelamento do registro.
const retries = new Map<StartupTask, () => Promise<void>>();

export function registerStartupRetry(task: StartupTask, retry: () => Promise<void>): () => void {
  retries.set(task, retry);
  return () => {
    if (retries.get(task) === retry) retries.delete(task);
  };
}

// Refaz só as tarefas que estão sem conexão e espera todas terminarem. Nunca rejeita (cada tarefa trata o próprio erro).
export async function retryStartupTasks(): Promise<void> {
  const pending = offlineTasks(state)
    .map((task) => retries.get(task))
    .filter((retry): retry is () => Promise<void> => retry !== undefined);
  await Promise.all(pending.map((retry) => retry().catch(() => undefined)));
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => state;

export function useStartupStatus(): Partial<Record<StartupTask, StartupOutcome>> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
