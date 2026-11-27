// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { invalidateAfter } from '@/lib/queryInvalidation';
import { queryKeys } from '@/lib/queryKeys';
import { makeBalance, makeProfit } from '@/test/profitFixtures';
import { renderUi } from '@/test/renderUi';
import ProfitEquation from './ProfitEquation';
import ProfitInfoStrip from './ProfitInfoStrip';

vi.mock('./useMarketSummary', () => ({ useMarketSummary: () => ({ summary: null }) }));

afterEach(cleanup);

const rowOf = (label: string) => screen.getByText(label).closest('div') as HTMLElement;

describe('ProfitEquation (12.7b)', () => {
  test('as seis linhas, com os operadores no texto, na ordem da fórmula', () => {
    const { container } = renderUi(<ProfitEquation data={makeProfit()} />);
    const terms = [...container.querySelectorAll('dt')].map((dt) => dt.textContent ?? '');
    expect(terms[0]).toContain('Withdrawals received');
    expect(terms.find((t) => t.includes('Available in stores'))).toMatch(/^\+/);
    expect(terms.find((t) => t.includes('Pending in stores'))).toMatch(/^\+/);
    expect(terms.find((t) => t.includes('Stock at cost'))).toMatch(/^\+/);
    expect(terms.find((t) => t.includes('Total deposited'))).toMatch(/^−/);
    expect(terms[terms.length - 1]).toMatch(/^=.*Real profit/);
    expect(screen.getByText('Stock for sale (cost)')).toBeInTheDocument();
    expect(screen.getByText('Stock in holding (cost)')).toBeInTheDocument();
  });

  test('o pendente tem linha própria, com o selo e a data da liberação', () => {
    renderUi(<ProfitEquation data={makeProfit()} />);
    const row = rowOf('Pending in stores');
    expect(within(row).getByText('on hold')).toBeInTheDocument();
    expect(within(row).getByText(/releases on/)).toBeInTheDocument();
    expect(within(row).getByText('$50.00')).toBeInTheDocument();
  });

  test('o lucro positivo leva "+"; estimado ganha "≈" e o selo', () => {
    renderUi(<ProfitEquation data={makeProfit({ estimated: true })} />);
    const row = rowOf('Real profit');
    expect(within(row).getByText('≈ +$300.00')).toBeInTheDocument();
    expect(within(row).getByText('estimated')).toBeInTheDocument();
  });

  test('lucro negativo mostra o sinal "−" no texto', () => {
    renderUi(<ProfitEquation data={makeProfit({ realProfitUsdCents: -1250, approx: { ...makeProfit().approx, realProfit: null } })} />);
    expect(within(rowOf('Real profit')).getByText(/^[−-]\$12\.50$/)).toBeInTheDocument();
  });

  test('lucro sem valor (falta de cotação) mostra "unavailable" com a ajuda', () => {
    renderUi(<ProfitEquation data={makeProfit({ realProfitUsdCents: null })} />);
    const row = rowOf('Real profit');
    expect(within(row).getByText('unavailable')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /Help/ })).toBeInTheDocument();
  });

  test('avisos vão para o Banner; legados e saques sem taxa viram notas; as taxas de aporte aparecem na nota', () => {
    renderUi(
      <ProfitEquation
        depositFeeCents={250}
        data={makeProfit({
          warnings: [{ source: 'STORE', storeId: 1, storeName: 'CSFloat', code: 'COMPUTED_BALANCE_NEGATIVE', text: '' }],
          counts: { ...makeProfit().counts, legacyDeposits: 2, withdrawalsWithoutFee: 1 },
        })}
      />,
    );
    expect(screen.getByText(/CSFloat: The calculated balance is negative/)).toBeInTheDocument();
    expect(screen.getByText(/2 old deposits/)).toBeInTheDocument();
    expect(screen.getByText(/1 withdrawal with no fee entered/)).toBeInTheDocument();
    expect(screen.getByText(/includes \$2\.50 of deposit fees/)).toBeInTheDocument();
  });

  test('cotação velha: o relógio de ajuda aparece junto do lucro', () => {
    // O relógio segue a cotação da moeda de conversão (`fx.display`, 12.12), não os campos antigos do real.
    const base = makeProfit().fx;
    const old = makeProfit({ fx: { ...base, display: { ...base.display!, quotedAt: '2020-01-02T00:00:00.000Z' } } });
    renderUi(<ProfitEquation data={old} />);
    expect(within(rowOf('Real profit')).getByRole('button', { name: /exchange rate may be outdated/i })).toBeInTheDocument();
  });

  test('sem nenhum movimento, aparece a dica da página vazia', () => {
    const empty = makeProfit({
      counts: { deposits: 0, legacyDeposits: 0, withdrawals: 0, legacyWithdrawals: 0, withdrawalsWithoutFee: 0, stockItems: 0, pendingSales: 0 },
      balancesByStore: [makeBalance({ availableCents: 0, availableUsdCents: 0 })],
    });
    renderUi(<ProfitEquation data={empty} />);
    expect(screen.getByText('Record your deposits to see the real profit.')).toBeInTheDocument();
  });
});

describe('ProfitInfoStrip e estoque dividido (8.9)', () => {
  test('os cards à venda e em holding mostram as partes do backend, e a soma bate com o estoque da equação', () => {
    const data = makeProfit();
    renderUi(<ProfitInfoStrip data={data} />, { client: new QueryClient() });
    expect(screen.getByText('Stock for sale (cost)')).toBeInTheDocument();
    expect(screen.getByText('Stock in holding (cost)')).toBeInTheDocument();
    expect(screen.getByText('$200.00')).toBeInTheDocument();
    expect(screen.getByText('$100.00')).toBeInTheDocument();
    expect((data.stockBreakdown.forSale.usdCents ?? 0) + (data.stockBreakdown.offSale.usdCents ?? 0)).toBe(data.stockUsdCents);
  });

  test('"já sacado vs. colocado" e as perdas por consumo (só com perdas)', () => {
    const data = makeProfit({ consumptionLosses: { usdCents: 1500, estimated: false, count: 2, approxCurrency: 'BRL', approx: 7500 } });
    renderUi(<ProfitInfoStrip data={data} />, { client: new QueryClient() });
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(screen.getByText('Losses on terminals')).toBeInTheDocument();
    expect(screen.getByText('2 terminals not bought')).toBeInTheDocument();
  });
});

describe('invalidação de holding (8.9)', () => {
  test('mover para holding e voltar à venda refrescam o resumo, mas não aportes, saques, saldos nem conferências', async () => {
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
