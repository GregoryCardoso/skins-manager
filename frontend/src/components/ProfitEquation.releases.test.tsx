// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { makeProfit } from '@/test/profitFixtures';
import { renderUi } from '@/test/renderUi';
import ProfitEquation from './ProfitEquation';

// 12.12 (relato do usuário): com liberações em datas diferentes, a nota do pendente diz quando TUDO estará liberado; a data mais
// próxima sozinha parecia valer para todo o valor.
afterEach(cleanup);
const renderEq = (data: ReturnType<typeof makeProfit>) =>
  renderUi(<ProfitEquation data={data} />, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });

describe('ProfitEquation: nota do pendente', () => {
  test('datas diferentes: "all released by" com a última data', () => {
    renderEq(makeProfit({ nextReleaseAt: '2026-11-29T10:00:00.000Z', lastReleaseAt: '2026-12-04T16:00:00.000Z' }));
    expect(screen.getByText(/all released by/)).toHaveTextContent(/12\/4\/26|Dec/);
    expect(screen.queryByText(/releases on 11\/29/)).toBeNull();
  });

  test('uma data só: continua "releases on"', () => {
    renderEq(makeProfit({ nextReleaseAt: '2026-11-29T10:00:00.000Z', lastReleaseAt: '2026-11-29T10:00:00.000Z' }));
    expect(screen.getByText(/releases on/)).toBeInTheDocument();
    expect(screen.queryByText(/all released by/)).toBeNull();
  });
});
