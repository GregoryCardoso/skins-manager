// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { STORES, makeItem } from '@/lib/testFixtures';
import { renderUi } from '@/test/renderUi';
import type { ItemView, SalesList, SaleInfo, UnsellPreview } from '@/types/api';

const api = vi.hoisted(() => ({
  listSales: vi.fn(),
  listStores: vi.fn(),
  getUnsellPreview: vi.fn(),
  unsellItem: vi.fn(),
  getSettings: vi.fn(),
}));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));
const nav = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/sales',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => ({ inventoryDensity: 'COMPACT' }) }));
vi.mock('@/components/ImportButton', () => ({ default: () => null }));

import SalesPage from './page';

const INFO: SaleInfo = {
  salePriceUsdCents: 1200, netReceivedUsdCents: 1100, purchaseCostUsdCents: 1000, ownCostUsdCents: 1000, inheritedCostUsdCents: 0,
  fxUsed: { sale: null, purchase: null }, usesRecordedFx: false, approxCurrency: 'BRL',
  approx: { salePrice: 6500, netReceived: 5900, purchaseCost: 5400, profit: 540 },
};

function sold(): ItemView {
  return makeItem({
    id: 7, status: 'VENDIDO', saleStoreId: 1, salePriceCents: 1200, saleCurrency: 'USD', netReceivedCents: 1100, soldAt: '2026-11-20T12:00:00.000Z',
    saleInfo: INFO, saleProfitUsdCents: 100, purchasePriceCents: 1000, aging: { turnaroundDays: 12, turnaroundBucket: 'GIRO_NORMAL', daysHeld: 30 },
  });
}

function list(items: ItemView[]): SalesList {
  return {
    items,
    summary: {
      count: items.length, totalSalePriceUsdCents: 1200, totalNetReceivedUsdCents: 1100, totalPurchaseCostUsdCents: 1000, totalProfitUsdCents: 100,
      avgTurnaroundDays: 12, soldWithFxCount: 0, approxCurrency: 'BRL', approx: { totalSalePrice: 6500, totalNetReceived: 5900, totalProfit: 540 },
    },
    meta: {
      count: items.length, saleStateCounts: { forSale: 0, offSale: 0 }, fastTurnoverDays: 7, slowItemDays: 21, usdBrlRate: 5.4,
      generatedAt: '2026-11-27T00:00:00.000Z', soldFrom: null, soldTo: null,
    },
  };
}

const PREVIEW: UnsellPreview = {
  itemId: 7, storeId: 1, storeName: 'CSFloat', storeCurrency: 'USD', balanceEffectCents: -1100, wasReleased: true, releasesAt: null,
  availableBeforeCents: 84210, availableAfterCents: 83110, pendingBeforeCents: 0, pendingAfterCents: 0, effectUsdCents: -1100,
  approxCents: null, approxCurrency: null, estimated: false, currencyMismatch: false, returnsTo: 'FOR_SALE',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderUi(<SalesPage />, { client, withToast: true });
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.listStores.mockResolvedValue(STORES);
  api.listSales.mockResolvedValue(list([sold()]));
  api.getUnsellPreview.mockResolvedValue(PREVIEW);
  api.getSettings.mockResolvedValue({});
  nav.query = '';
});
afterEach(cleanup);

describe('página Vendas', () => {
  test('mostra o resumo, a tabela e a legenda da régua', async () => {
    renderPage();
    expect(await screen.findByText('AK-47 | Linha Vermelha')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Period summary' })).toBeInTheDocument();
    expect(screen.getAllByText(/Days counted from the end/).length).toBeGreaterThan(0);
  });

  test('desfazer venda pelo menu abre o diálogo com o efeito no saldo da loja', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('AK-47 | Linha Vermelha');
    await user.click(screen.getByRole('button', { name: /More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Undo sale' }));
    expect(await screen.findByText(/leaves the available balance of CSFloat/)).toBeInTheDocument();
    expect(api.getUnsellPreview).toHaveBeenCalledWith(7, expect.anything());
  });

  test('sem vendas: estado vazio; com filtro ativo e sem resultado: oferece limpar os filtros', async () => {
    api.listSales.mockResolvedValue(list([]));
    renderPage();
    expect(await screen.findByText('No sales yet')).toBeInTheDocument();
    cleanup();
    nav.query = 'period=LAST_7';
    renderPage();
    expect(await screen.findByText('No sales match')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Clear filters' }).length).toBeGreaterThan(0);
  });

  test('falha ao carregar: ErrorState com "Try again" que recarrega', async () => {
    const user = userEvent.setup();
    api.listSales.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    const retry = await screen.findByRole('button', { name: 'Try again' });
    api.listSales.mockResolvedValue(list([sold()]));
    await user.click(retry);
    await waitFor(() => expect(screen.getByText('AK-47 | Linha Vermelha')).toBeInTheDocument());
  });
});
