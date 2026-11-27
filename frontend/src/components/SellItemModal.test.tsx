// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeItem, STORES } from '@/lib/testFixtures';
import { ApiRequestError } from '@/services/api';
import { renderUi } from '@/test/renderUi';
import type { ItemView } from '@/types/api';

const api = vi.hoisted(() => ({ getSaleQuote: vi.fn(), sellItem: vi.fn() }));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));
vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => ({ usdBrlRate: 5, fxRates: [{ currency: 'BRL', rate: 5 }] }) }));

import SellItemModal from './SellItemModal';

const LOCKED = { isLocked: true, remainingMs: 86_400_000, formatted: '1d', tradeUnlockAt: '2099-01-01T12:00:00.000Z' };

function renderSell(props: Partial<React.ComponentProps<typeof SellItemModal>> = {}) {
  const handlers = { onClose: vi.fn(), onSold: vi.fn(), onGone: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderUi(<SellItemModal item={makeItem({ id: 1 })} stores={STORES} {...handlers} {...props} />, { client });
  return handlers;
}

const sold = (net = 122) => ({
  item: makeItem({ id: 1, status: 'VENDIDO' }),
  sale: { netReceivedCents: net, feeCents: 3, netReceivedManual: false, saleHoldDaysApplied: 7, saleProfitUsdCents: 22 },
});

beforeEach(() => {
  api.getSaleQuote.mockReset();
  api.sellItem.mockReset();
  api.getSaleQuote.mockResolvedValue({ storeId: 1, currency: 'USD', salePriceCents: 125, feeCents: 3, netReceivedCents: 122 });
});
afterEach(cleanup);

describe('SellItemModal: loja com taxas configuradas', () => {
  test('o líquido fica recolhido: aparece "Você recebe" calculado e o campo só em "Mais detalhes"', async () => {
    renderSell();
    expect(screen.queryByLabelText(/Net received/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Sale price/), '1.25');
    expect(await screen.findByText('$1.22')).toBeInTheDocument();
    expect(screen.getByText('You receive')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More details' }));
    expect(screen.getByLabelText(/Net received/)).toHaveValue('1.22');
  });

  test('envia o corpo da venda sem o líquido (o backend calcula) e avisa o chamador', async () => {
    api.sellItem.mockResolvedValue(sold());
    const { onSold } = renderSell();
    await userEvent.type(screen.getByLabelText(/Sale price/), '1.25');
    await screen.findByText('$1.22');
    await userEvent.click(screen.getByRole('button', { name: 'Record sale' }));
    await waitFor(() => expect(api.sellItem).toHaveBeenCalledTimes(1));
    expect(api.sellItem.mock.calls[0][0]).toBe(1);
    expect(api.sellItem.mock.calls[0][1]).toMatchObject({ saleStoreId: 1, salePriceCents: 125 });
    expect(api.sellItem.mock.calls[0][1]).not.toHaveProperty('netReceivedCents');
    await waitFor(() => expect(onSold).toHaveBeenCalledTimes(1));
  });

  test('preço vazio: o resumo de erros aparece e nada é enviado', async () => {
    renderSell();
    await userEvent.click(screen.getByRole('button', { name: 'Record sale' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the sale price.');
    expect(api.sellItem).not.toHaveBeenCalled();
  });

  test('erro da cotação da venda (loja em BRL) abre "Mais detalhes" e mostra o erro no campo', async () => {
    api.sellItem.mockRejectedValue(new ApiRequestError('INVALID_FX_RATE', 'Cotação inválida.', 400, { field: 'fxRateAtSale' }));
    renderSell();
    await userEvent.selectOptions(screen.getByLabelText(/Sale store/), '2');
    expect(screen.queryByLabelText(/USD→BRL rate/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Price paid by the buyer/), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Record sale' }));
    const field = await screen.findByLabelText(/USD→BRL rate/);
    expect(field).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('SellItemModal: loja sem taxas', () => {
  test('o líquido é obrigatório e fica à vista, com o aviso e o link para Lojas', async () => {
    renderSell();
    await userEvent.selectOptions(screen.getByLabelText(/Sale store/), '3');
    expect(screen.getByLabelText(/Net received/)).toBeRequired();
    expect(screen.queryByText('You receive')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Go to Stores' });
    expect(link).toHaveAttribute('href', '/stores');
    expect(screen.getByText(/no sale fees set/)).toBeInTheDocument();
  });

  test('o líquido digitado vai no corpo', async () => {
    api.sellItem.mockResolvedValue(sold(110));
    renderSell();
    await userEvent.selectOptions(screen.getByLabelText(/Sale store/), '3');
    await userEvent.type(screen.getByLabelText(/Sale price/), '1.25');
    await userEvent.type(screen.getByLabelText(/Net received/), '1.10');
    await userEvent.click(screen.getByRole('button', { name: 'Record sale' }));
    await waitFor(() => expect(api.sellItem).toHaveBeenCalledTimes(1));
    expect(api.sellItem.mock.calls[0][1]).toMatchObject({ saleStoreId: 3, salePriceCents: 125, netReceivedCents: 110 });
  });
});

describe('SellItemModal: seletor de unidade (venda pela linha do grupo)', () => {
  const units: ItemView[] = [
    makeItem({ id: 1, floatValue: 0.11, tradeLock: LOCKED }),
    makeItem({ id: 2, floatValue: 0.22 }),
    makeItem({ id: 3, floatValue: 0.33 }),
  ];

  test('sem unidades (ou com uma só) não há seletor', () => {
    renderSell();
    expect(screen.queryByLabelText('Unit')).not.toBeInTheDocument();
  });

  test('lista as unidades; a em trade lock fica desabilitada com a data; vender envia a unidade escolhida', async () => {
    api.sellItem.mockResolvedValue(sold());
    renderSell({ item: units[1], units });
    const select = screen.getByLabelText('Unit') as HTMLSelectElement;
    expect(select).toHaveValue('2');
    const options = Array.from(select.options);
    expect(options).toHaveLength(3);
    expect(options[0]).toBeDisabled();
    expect(options[0].textContent).toMatch(/Trade locked until/);
    expect(options[1]).toBeEnabled();
    await userEvent.selectOptions(select, '3');
    await userEvent.type(screen.getByLabelText(/Sale price/), '1.25');
    await screen.findByText('$1.22');
    await userEvent.click(screen.getByRole('button', { name: 'Record sale' }));
    await waitFor(() => expect(api.sellItem).toHaveBeenCalledTimes(1));
    expect(api.sellItem.mock.calls[0][0]).toBe(3);
  });
});
