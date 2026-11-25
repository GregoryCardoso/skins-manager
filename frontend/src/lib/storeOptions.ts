import type { Store } from '@/types/api';

// Lojas dos seletores de lançamento (cadastro de item e venda): só as ativas. Na edição, a loja gravada (de compra ou de venda)
// continua na lista, mesmo inativa, para aparecer selecionada com o rótulo "(inativa)".
export function launchStoreOptions(stores: readonly Store[], keepStoreIds: ReadonlyArray<number | null | undefined> = []): Store[] {
  const keep = new Set(keepStoreIds.filter((id): id is number => typeof id === 'number'));
  return stores.filter((store) => store.isActive || keep.has(store.id));
}
