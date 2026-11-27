// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { makeProfit } from '@/test/profitFixtures';
import { renderUi } from '@/test/renderUi';
import ProfitEquation from './ProfitEquation';

// 12.12 (pedido do usuário): a nota "Values with ≈ are estimated using the ... rate" segue a moeda de conversão (antes, sempre o real)
// e não aparece em USD, onde não há "≈".
afterEach(cleanup);

const renderEq = (data: ReturnType<typeof makeProfit>) =>
  renderUi(<ProfitEquation data={data} />, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });

describe('ProfitEquation: nota da cotação pela moeda de conversão', () => {
  test('EUR: a nota mostra a cotação do euro, não a do real', () => {
    renderEq(makeProfit({
      approxCurrency: 'EUR',
      fx: {
        usdBrlRate: 5.5431, source: 'AWESOMEAPI', updatedAt: '2026-11-27T15:15:00.000Z', quotedAt: '2026-11-27T15:15:00.000Z', displayCurrency: 'EUR',
        display: { currency: 'EUR', rate: 0.92, source: 'MANUAL', quotedAt: null, updatedAt: '2026-11-27T15:00:00.000Z' },
      },
    }));
    const note = screen.getByText(/Values with ≈ are estimated/);
    expect(note.textContent).toMatch(/€|EUR/);
    expect(note.textContent).not.toMatch(/R\$|5\.5431/);
  });

  test('USD: nenhuma nota de cotação', () => {
    renderEq(makeProfit({
      approxCurrency: 'USD',
      fx: {
        usdBrlRate: 5.5431, source: 'AWESOMEAPI', updatedAt: null, quotedAt: null, displayCurrency: 'USD',
        display: { currency: 'USD', rate: null, source: null, quotedAt: null, updatedAt: null },
      },
    }));
    expect(screen.queryByText(/Values with ≈ are estimated/)).toBeNull();
  });

  test('moeda sem cotação: a nota pede a cotação em Configurações', () => {
    renderEq(makeProfit({
      fx: {
        usdBrlRate: null, source: null, updatedAt: null, quotedAt: null, displayCurrency: 'JPY',
        display: { currency: 'JPY', rate: null, source: null, quotedAt: null, updatedAt: null },
      },
    }));
    expect(screen.getByText(/which is not set yet/)).toBeInTheDocument();
  });
});
