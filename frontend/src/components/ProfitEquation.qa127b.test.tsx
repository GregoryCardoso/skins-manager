// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeProfit } from '@/test/profitFixtures';
import { renderUi } from '@/test/renderUi';
import ProfitEquation from './ProfitEquation';

vi.mock('./useMarketSummary', () => ({ useMarketSummary: () => ({ summary: null }) }));
afterEach(cleanup);

const rowOf = (label: string) => screen.getByText(label).closest('div') as HTMLElement;

describe('ProfitEquation (QA 12.7b): a tela só mostra o que a API manda', () => {
  test('o lucro mostrado é o da API mesmo que a soma das linhas não bata (sem recálculo no front)', () => {
    // Soma real das linhas: 20000 + 75000 + 5000 + 30000 - 100000 = 30000; a API manda 12345 de propósito.
    renderUi(<ProfitEquation data={makeProfit({ realProfitUsdCents: 12345, approx: { ...makeProfit().approx, realProfit: 61725 } })} />);
    expect(within(rowOf('Real profit')).getByText('+$123.45')).toBeInTheDocument();
    expect(within(rowOf('Real profit')).queryByText('+$300.00')).toBeNull();
  });

  test('cada linha mostra exatamente o valor da API (saques, disponível, pendente, estoque, aportes)', () => {
    renderUi(<ProfitEquation data={makeProfit()} />);
    expect(within(rowOf('Withdrawals received')).getByText('$200.00')).toBeInTheDocument();
    expect(within(rowOf('Available in stores')).getByText('$750.00')).toBeInTheDocument();
    expect(within(rowOf('Pending in stores')).getByText('$50.00')).toBeInTheDocument();
    expect(within(rowOf('Stock at cost')).getByText('$300.00')).toBeInTheDocument();
    expect(within(rowOf('Total deposited')).getByText('$1,000.00')).toBeInTheDocument();
  });

  test('sub-linhas à venda + holding somam o estoque da API', () => {
    const data = makeProfit();
    renderUi(<ProfitEquation data={data} />);
    expect(within(rowOf('Stock for sale (cost)')).getByText('$200.00')).toBeInTheDocument();
    expect(within(rowOf('Stock in holding (cost)')).getByText('$100.00')).toBeInTheDocument();
    expect((data.stockBreakdown.forSale.usdCents ?? 0) + (data.stockBreakdown.offSale.usdCents ?? 0)).toBe(data.stockUsdCents);
  });

  test('sem pendente: a linha continua, sem selo "on hold" e sem data de liberação', () => {
    renderUi(<ProfitEquation data={makeProfit({ pendingBalanceUsdCents: 0, nextReleaseAt: null, approx: { ...makeProfit().approx, pendingBalance: 0 } })} />);
    const row = rowOf('Pending in stores');
    expect(within(row).queryByText(/releases on/)).toBeNull();
  });

  test('sem avisos: nenhum Banner de aviso aparece', () => {
    renderUi(<ProfitEquation data={makeProfit({ warnings: [] })} />);
    expect(screen.queryByText(/calculated balance is negative/)).toBeNull();
  });

  test('cotação recente: o relógio de "cotação velha" não aparece', () => {
    const fresh = makeProfit({ fx: { ...makeProfit().fx, quotedAt: new Date().toISOString() } });
    renderUi(<ProfitEquation data={fresh} />);
    expect(within(rowOf('Real profit')).queryByRole('button', { name: /exchange rate may be outdated/i })).toBeNull();
  });
});
