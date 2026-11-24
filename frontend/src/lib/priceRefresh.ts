// Quando e como buscar os preços de mercado ao abrir o app (10.6, D365 itens 3 e 4). Funções puras.
import type { IntegrationView, MarketValueRefreshResponse } from '@/types/api';
import type { AutoImportProgress } from './autoImportProgress';
import { shouldRunAutoImport } from './autoImport';

// Espera antes da primeira chamada e antes da repetição por `BUSY`.
export const START_DELAY_MS = 1000;
export const BUSY_RETRY_DELAY_MS = 5000;
// Teto da espera pela importação no repique do `BUSY` (a importação tem o próprio prazo de 270 s).
export const BUSY_RETRY_MAX_WAIT_MS = 300000;

export type IntegrationQueryStatus = 'pending' | 'success' | 'error';

// A importação automática vem primeiro (os preços dependem dos itens novos): espera enquanto a consulta da integração não chegou, enquanto a
// importação roda ou enquanto ela é devida e ainda não começou. Sem importação a fazer (desligada, pausada, sem chave, sem loja, sem corte,
// ou uma importação manual em curso), vai direto. Consulta com erro: `integration` nulo -> vai (o POST falha em silêncio).
export function decidePriceRefreshStart(input: {
  integrationStatus: IntegrationQueryStatus;
  integration: IntegrationView | null;
  autoImport: AutoImportProgress;
}): 'WAIT' | 'GO' {
  if (input.integrationStatus === 'pending') return 'WAIT';
  if (input.autoImport === 'RUNNING') return 'WAIT';
  if (input.autoImport === 'DONE') return 'GO';
  return shouldRunAutoImport(input.integration) ? 'WAIT' : 'GO';
}

export type RefreshInvalidation = 'marketValues.refresh' | 'marketValues.status';
export interface AfterRefresh {
  action: 'DONE' | 'RETRY_WHEN_IDLE';
  invalidate: RefreshInvalidation;
}

// O que fazer com o resultado do POST (ou com o erro de rede/TIMEOUT): `BUSY` na 1.ª vez repete uma única vez; todo o resto termina. Só
// preço novo gravado (`fetched > 0`) recarrega os itens; o resto atualiza só o indicador.
export function nextAfterRefresh(outcome: MarketValueRefreshResponse | unknown, { retried }: { retried: boolean }): AfterRefresh {
  const status: AfterRefresh = { action: 'DONE', invalidate: 'marketValues.status' };
  if (typeof outcome !== 'object' || outcome === null || !('skipped' in outcome)) return status;
  const response = outcome as MarketValueRefreshResponse;
  if (response.skipped === 'BUSY' && !retried) return { action: 'RETRY_WHEN_IDLE', invalidate: 'marketValues.status' };
  if (response.skipped || response.failed) return status;
  if (response.result && response.result.fetched > 0) return { action: 'DONE', invalidate: 'marketValues.refresh' };
  return status;
}
