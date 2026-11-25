import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate } from '@/i18n/translate';
import { invalidateAfter } from '@/lib/queryInvalidation';
import { queryKeys } from '@/lib/queryKeys';

// 8.9 (D283): cards "Estoque à venda (custo)" e "Estoque em holding (custo)" depois do card existente de estoque.
const source = fs.readFileSync(path.join(__dirname, 'SummaryCards.tsx'), 'utf8');

describe('SummaryCards 8.9', () => {
  test('chaves novas existem nos dois idiomas, sem marcadores', () => {
    expect(translate(ptBR, 'profit.summary.stockForSale')).toBe('Estoque à venda (custo)');
    expect(translate(ptBR, 'profit.summary.stockOffSale')).toBe('Estoque em holding (custo)');
    for (const key of ['profit.summary.stockForSale', 'profit.summary.stockOffSale']) {
      const text = translate(en, key);
      expect(text).not.toBe(key);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/\{\w+\}/);
    }
  });

  test('o card existente de estoque mantém a chave e o texto', () => {
    expect(translate(ptBR, 'profit.summary.stock')).toBe('Estoque (pelo custo)');
    expect(translate(en, 'profit.summary.stock')).toBe('Stock (at cost)');
    expect(source).toMatch(/t\('profit\.summary\.stock'\)/);
    expect(source).toMatch(/amount\(data\.stockUsdCents, data\.approx\.stock, data\.estimatedParts\.stock\)/);
  });

  test('os dois cards novos vêm depois do de estoque, nesta ordem, e antes do "já sacado vs. colocado"', () => {
    const at = (key: string) => source.indexOf(`t('${key}')`);
    const stock = at('profit.summary.stock');
    const forSale = at('profit.summary.stockForSale');
    const offSale = at('profit.summary.stockOffSale');
    const ratio = at('profit.summary.withdrawnVsDeposited');
    expect(stock).toBeGreaterThan(-1);
    expect(stock).toBeLessThan(forSale);
    expect(forSale).toBeLessThan(offSale);
    expect(offSale).toBeLessThan(ratio);
  });

  test('os cards novos usam o breakdown do backend (US$ com ≈ e ≈ R$ abaixo)', () => {
    expect(source).toContain('amount(data.stockBreakdown.forSale.usdCents, data.stockBreakdown.forSale.approx, data.stockBreakdown.forSale.estimated)');
    expect(source).toContain('amount(data.stockBreakdown.offSale.usdCents, data.stockBreakdown.offSale.approx, data.stockBreakdown.offSale.estimated)');
  });

  test('as invalidações de holding refrescam o resumo mas não aportes, saques, saldos nem conferências', async () => {
    for (const action of ['item.offSale', 'item.backOnSale'] as const) {
      const client = new QueryClient();
      const keys = [
        queryKeys.profitSummary.all, queryKeys.deposits.all, queryKeys.withdrawals.all,
        queryKeys.storeBalances.current, queryKeys.storeBalances.history(1),
      ];
      for (const k of keys) client.setQueryData(k, {});
      await invalidateAfter(client, action);
      expect(keys.map((k) => Boolean(client.getQueryState(k)?.isInvalidated))).toEqual([true, false, false, false, false]);
    }
  });
});
