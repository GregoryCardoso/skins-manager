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
  | { kind: 'TRANSFERS'; count: number }
  | { kind: 'MATCHED'; count: number }
  | { kind: 'ATTENTION' }
  | { kind: 'NOTHING_NEW' };

// O aviso do lote automático: "N trades importados" (compras + vendas criadas); senão, aportes/saques importados; senão, ligados;
// senão, só pendências. Sem lote (nada novo), o aviso curto "nada novo" (pedido do usuário: a pessoa sabe que já foi conferido).
export function autoImportNotice(batch: ImportBatchView | null): AutoImportNotice {
  if (!batch) return { kind: 'NOTHING_NEW' };
  const created = batch.counts.purchasesCreated + batch.counts.salesCreated;
  if (created > 0) return { kind: 'CREATED', count: created };
  const transfers = (batch.counts.depositsCreated ?? 0) + (batch.counts.withdrawalsCreated ?? 0);
  if (transfers > 0) return { kind: 'TRANSFERS', count: transfers };
  if (batch.counts.matched > 0) return { kind: 'MATCHED', count: batch.counts.matched };
  return { kind: 'ATTENTION' };
}

// O aviso "nada novo" some sozinho depois deste tempo (é só informativo); os outros ficam até a pessoa fechar.
export const NOTHING_NEW_DISMISS_MS = 8000;

// Motivo da pausa, para o card (D302): desfazer (com a data) ou troca de conta.
export function pausedReason(integration: IntegrationView): { kind: 'UNDO'; at: string } | { kind: 'ACCOUNT_SWITCH' } | null {
  if (!integration.autoImportPaused) return null;
  return integration.lastUndoneAt ? { kind: 'UNDO', at: integration.lastUndoneAt } : { kind: 'ACCOUNT_SWITCH' };
}
