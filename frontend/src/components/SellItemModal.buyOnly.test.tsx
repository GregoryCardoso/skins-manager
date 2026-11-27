// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeItem, makeStore } from '@/lib/testFixtures';
import { renderUi } from '@/test/renderUi';
import type { Store } from '@/types/api';

const api = vi.hoisted(() => ({ getSaleQuote: vi.fn(), sellItem: vi.fn() }));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));
vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => ({ usdBrlRate: 5, fxRates: [{ currency: 'BRL', rate: 5 }] }) }));

import SellItemModal from './SellItemModal';

const WARNING = 'This store is set to buy only. Turn on "Selling on this store" in Stores to sell on it.';
const FEE = { saleFeeType: 'DEDUCTED' as const, saleFeeRate: 0.02, saleFeesConfigured: true };

function renderSell(stores: Store[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderUi(<SellItemModal item={makeItem({ id: 1 })} stores={stores} onClose={vi.fn()} onSold={vi.fn()} onGone={vi.fn()} />, { client });
}

beforeEach(() => {
  api.getSaleQuote.mockReset();
  api.sellItem.mockReset();
  api.getSaleQuote.mockResolvedValue({ storeId: 1, currency: 'USD', salePriceCents: 125, feeCents: 3, netReceivedCents: 122 });
});
afterEach(cleanup);

describe('SellItemModal: loja só compra (D370)', () => {
  test('a loja inicial é uma que vende, mesmo com a principal só compra', () => {
    renderSell([
      makeStore({ id: 1, name: 'Principal', isPrimary: true, sellsHere: false, ...FEE }),
      makeStore({ id: 2, name: 'Outra', sellsHere: true, ...FEE }),
    ]);
    expect(screen.getByLabelText(/Sale store/)).toHaveValue('2');
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  test('escolher uma loja só compra mostra o aviso com o link para Lojas e desativa o botão com o motivo ligado', async () => {
    renderSell([
      makeStore({ id: 1, name: 'CSFloat', isPrimary: true, ...FEE }),
      makeStore({ id: 2, name: 'Steam', sellsHere: false, ...FEE }),
    ]);
    expect(screen.getByRole('option', { name: 'Steam (buy only)' })).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Record sale' });
    expect(submit).not.toHaveAttribute('aria-disabled');
    await userEvent.selectOptions(screen.getByLabelText(/Sale store/), '2');
    const warning = await screen.findByText(WARNING);
    expect(screen.getByRole('link', { name: 'Go to Stores' })).toHaveAttribute('href', '/stores');
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    expect(submit.getAttribute('aria-describedby')).toBe(warning.id);
    await userEvent.type(screen.getByLabelText(/Sale price/), '1.25');
    await userEvent.click(submit);
    expect(api.sellItem).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText(/Sale store/), '1');
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
    expect(submit).not.toHaveAttribute('aria-disabled');
  });
});
