// Importação ao abrir o app (9.5, D303): quando disparar e o que o aviso discreto diz. Funções puras.
import type { ImportBatchView, IntegrationView } from '@/types/api';

// Dispara só com a opção ligada, chave, loja, primeira importação feita (corte), sem pausa e sem outra importação em curso.
// O backend confere tudo de novo (e roda no máximo uma vez por processo); aqui é só para não fazer a chamada à toa.
export function shouldRunAutoImport(integration: IntegrationView | null): boolean {
  if (!integration) return false;
  return (
    integration.autoImportOnOpen
    && !integration.autoImportPaused
    && integration.hasApiKey
    && integration.storeId !== null
    && integration.tradesCutoffAt !== null
    && !integration.importInProgress
  );
}

export type AutoImportNotice =
  | { kind: 'CREATED'; count: number }
  | { kind: 'MATCHED'; count: number }
  | { kind: 'ATTENTION' };

// O aviso do lote automático: "N trades importados" (compras + vendas criadas); senão, ligados; senão, só pendências. Sem lote
// (nada novo), não há aviso.
export function autoImportNotice(batch: ImportBatchView | null): AutoImportNotice | null {
  if (!batch) return null;
  const created = batch.counts.purchasesCreated + batch.counts.salesCreated;
  if (created > 0) return { kind: 'CREATED', count: created };
  if (batch.counts.matched > 0) return { kind: 'MATCHED', count: batch.counts.matched };
  return { kind: 'ATTENTION' };
}

// Motivo da pausa, para o card (D302): desfazer (com a data) ou troca de conta.
export function pausedReason(integration: IntegrationView): { kind: 'UNDO'; at: string } | { kind: 'ACCOUNT_SWITCH' } | null {
  if (!integration.autoImportPaused) return null;
  return integration.lastUndoneAt ? { kind: 'UNDO', at: integration.lastUndoneAt } : { kind: 'ACCOUNT_SWITCH' };
}
