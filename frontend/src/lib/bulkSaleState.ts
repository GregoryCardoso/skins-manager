// Holding em lote no inventário agrupado (9.5.1a, D332, D334). Funções puras.
import type { ItemGroup, SaleState } from '@/types/api';

// Quantidade digitada: inteiro de 1 até `max`, ou null (inválida).
export function parseBulkQuantity(text: string, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= max ? value : null;
}

// Unidades à venda do grupo (inclusive em trade lock) e no holding: o que cada ação em lote pode mover.
export const forSaleCount = (group: ItemGroup): number => group.stock.forSale + group.stock.tradeLocked;
export const holdingCount = (group: ItemGroup): number => group.stock.offSale;

// A ação em lote da linha do grupo na aba atual (ou null, se não há o que mover).
export function groupBulkAction(group: ItemGroup, saleState: SaleState): { direction: 'OFF_SALE' | 'FOR_SALE'; available: number } | null {
  if (saleState === 'OFF_SALE') return holdingCount(group) > 0 ? { direction: 'FOR_SALE', available: holdingCount(group) } : null;
  return forSaleCount(group) > 0 ? { direction: 'OFF_SALE', available: forSaleCount(group) } : null;
}
