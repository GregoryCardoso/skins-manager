// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderUi } from '@/test/renderUi';
import type { ItemView, MinPrice } from '@/types/api';
import MinPriceSummary, { GroupMinPrice } from './MinPriceSummary';

vi.mock('../PreferencesProvider', () => ({ usePreferences: () => null }));

afterEach(cleanup);

const stores = [{ id: 1, isPrimary: true }] as never;
const priced = (cents: number) => ({ storeId: 1, storeName: 'Steam', minPriceCents: cents, currency: 'USD', approx: null, warning: null, warningCode: null }) as unknown as MinPrice;
const noFee = { storeId: 1, storeName: 'Steam', minPriceCents: null, currency: 'USD', approx: null, warning: 'x', warningCode: 'FEES_NOT_CONFIGURED' } as unknown as MinPrice;
const help = () => screen.getByRole('button', { name: /^Help:/ });

describe('preço mínimo compacto com ajuda por linha (D370)', () => {
  test('sem taxa: "no price" curto, sem aviso grande, e o balão cita a loja e leva a Lojas', async () => {
    const { container } = renderUi(<MinPriceSummary minPrices={[noFee]} stores={stores} />);
    expect(screen.getByText('no price')).toBeInTheDocument();
    expect(screen.queryByText(/no sale fee set/i)).toBeNull();
    await userEvent.click(help());
    expect(screen.getByText(/The store Steam has no sale fee set/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Stores' }).getAttribute('href')).toMatch(/^\/stores\/?$/);
    expect(container.querySelector('[title]')).toBeNull();
  });

  test('com taxa: mostra o valor e o balão diz que se baseia na taxa da loja na aba Lojas; abre pelo teclado', async () => {
    renderUi(<MinPriceSummary minPrices={[priced(1000)]} stores={stores} />);
    expect(screen.getByText(/10\.00/)).toBeInTheDocument();
    help().focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText(/based on the sale fee set for Steam in the Stores tab/)).toBeInTheDocument();
  });

  test('faixa do grupo: um "?" só, com o texto da faixa', async () => {
    const units = [{ minPrices: [priced(1000)] }, { minPrices: [priced(2000)] }] as unknown as ItemView[];
    renderUi(<GroupMinPrice units={units} stores={stores} />);
    expect(screen.getAllByRole('button', { name: /^Help:/ })).toHaveLength(1);
    await userEvent.click(help());
    expect(screen.getByText(/Range of the break-even prices/)).toBeInTheDocument();
  });
});
