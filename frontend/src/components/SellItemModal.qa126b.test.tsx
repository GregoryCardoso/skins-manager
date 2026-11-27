// @vitest-environment jsdom
import '@/test/setupDom';
import { useState } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeItem, makeStore, STORES } from '@/lib/testFixtures';
import { ApiRequestError } from '@/services/api';
import { renderUi } from '@/test/renderUi';
import type { ItemView, MinPrice } from '@/types/api';

const api = vi.hoisted(() => ({ getSaleQuote: vi.fn(), sellItem: vi.fn() }));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));
vi.mock('@/components/PreferencesProvider', () => ({
  usePreferences: () => ({ usdBrlRate: 5, fxRates: [{ currency: 'BRL', rate: 5 }, { currency: 'JPY', rate: 150 }] }),
}));

import SellItemModal from './SellItemModal';

const JPY_STORE = makeStore({ id: 5, name: 'Loja JPY', currency: 'JPY', saleFeeType: 'DEDUCTED', saleFeeRate: 0.02, saleFeesConfigured: true });
const ALL_STORES = [...STORES, JPY_STORE];
const LOCKED = { isLocked: true, remainingMs: 86_400_000, formatted: '1d', tradeUnlockAt: '2099-01-01T12:00:00.000Z' };
const minPrice = (extra: Partial<MinPrice> = {}): MinPrice => ({
  storeId: 1, storeName: 'CSFloat', currency: 'USD', minPriceCents: 105, approx: null, warning: null, warningCode: null, ...extra,
});

function renderSell(props: Partial<React.ComponentProps<typeof SellItemModal>> = {}) {
  const handlers = { onClose: vi.fn(), onSold: vi.fn(), onGone: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderUi(<SellItemModal item={makeItem({ id: 1 })} stores={ALL_STORES} {...handlers} {...props} />, { client });
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

describe('SellItemModal: líquido editável, Recalcular e preço mínimo', () => {
  test('editar o líquido mostra "Recalculate"; ele volta ao calculado; o manual vai no corpo', async () => {
    api.sellItem.mockResolvedValue(sold(100));
    renderSell();
    await userEvent.type(screen.getByLabelText(/Sale price/), '1.25');
    await screen.findByText('$1.22');
    await userEvent.click(screen.getByRole('button', { name: 'More details' }));
    expect(screen.queryByRole('button', { name: 'Recalculate' })).not.toBeInTheDocument();
    const net = screen.getByLabelText(/Net received/);
    await userEvent.clear(net);
    await userEvent.type(net, '1.00');
    // "Você recebe" passa a mostrar o valor digitado
    expect(screen.getAllByText('$1.00').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Recalculate' }));
    expect(screen.getByLabelText(/Net received/)).toHaveValue('1.22');
    expect(screen.queryByRole('button', { name: 'Recalculate' })).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText(/Net received/));
    await userEvent.type(screen.getByLabelText(/Net received/), '1.00');
    await userEvent.click(screen.getByRole('button', { name: 'Record sale' }));
    await waitFor(() => expect(api.sellItem).toHaveBeenCalledTimes(1));
    expect(api.sellItem.mock.calls[0][1]).toMatchObject({ salePriceCents: 125, netReceivedCents: 100 });
  });

  test('"Use the break-even price" preenche o preço e pede a prévia com esse valor', async () => {
    renderSell({ item: makeItem({ id: 1, minPrices: [minPrice()] }) });
    expect(screen.getByText('Break-even price')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use the break-even price' }));
    expect(screen.getByLabelText(/Sale price/)).toHaveValue('1.05');
    await waitFor(() => expect(api.getSaleQuote).toHaveBeenCalledWith(1, 105, expect.anything()));
  });

  test('preço mínimo sem valor (aviso) não mostra o botão', () => {
    renderSell({ item: makeItem({ id: 1, minPrices: [minPrice({ minPriceCents: null, warning: 'Sem preço', warningCode: null })] }) });
    expect(screen.queryByRole('button', { name: 'Use the break-even price' })).not.toBeInTheDocument();
    expect(screen.getByText('Sem preço')).toBeInTheDocument();
  });

  test('o erro do líquido (campo escondido) abre "Mais detalhes" e marca o campo', async () => {
    api.sellItem.mockRejectedValue(new ApiRequestError('NET_RECEIVED_NEGATIVE', 'Líquido negativo.', 400, { field: 'netReceivedCents' }));
    renderSell();
    await userEvent.type(screen.getByLabelText(/Sale price/), '1.25');
    await screen.findByText('$1.22');
    expect(screen.queryByLabelText(/Net received/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Record sale' }));
    const net = await screen.findByLabelText(/Net received/);
    expect(net).toHaveAttribute('aria-invalid', 'true');
  });

  test('erro sem campo conhecido vai para o topo; ITEM_NOT_FOUND chama onGone', async () => {
    api.sellItem.mockRejectedValueOnce(new ApiRequestError('INTERNAL_ERROR', 'Falha geral', 500));
    const { onGone } = renderSell();
    await userEvent.type(screen.getByLabelText(/Sale price/), '1.25');
    await userEvent.click(screen.getByRole('button', { name: 'Record sale' }));
    await waitFor(() => expect(api.sellItem).toHaveBeenCalledTimes(1));
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(onGone).not.toHaveBeenCalled();
    api.sellItem.mockRejectedValueOnce(new ApiRequestError('ITEM_NOT_FOUND', 'sumiu', 404));
    await userEvent.click(screen.getByRole('button', { name: 'Record sale' }));
    await waitFor(() => expect(onGone).toHaveBeenCalledTimes(1));
  });
});

describe('SellItemModal: moeda sem casas decimais (JPY)', () => {
  test('o preço em ienes inteiros vira centavos de iene (x100) e a prévia usa a loja JPY', async () => {
    api.sellItem.mockResolvedValue(sold(122500));
    renderSell({ item: makeItem({ id: 1, minPrices: [minPrice({ storeId: 5, storeName: 'Loja JPY', currency: 'JPY', minPriceCents: 125000 })] }) });
    await userEvent.selectOptions(screen.getByLabelText(/Sale store/), '5');
    const price = screen.getByLabelText(/Sale price/);
    await userEvent.click(screen.getByRole('button', { name: 'Use the break-even price' }));
    expect(price).toHaveValue('1250'); // sem casas decimais
    await waitFor(() => expect(api.getSaleQuote).toHaveBeenCalledWith(5, 125000, expect.anything()));
    // decimal digitado em JPY não é aceito
    await userEvent.clear(price);
    await userEvent.type(price, '12.5');
    await userEvent.click(screen.getByRole('button', { name: 'Record sale' }));
    expect(api.sellItem).not.toHaveBeenCalled();
    await userEvent.clear(price);
    await userEvent.type(price, '1250');
    await userEvent.click(screen.getByRole('button', { name: 'Record sale' }));
    await waitFor(() => expect(api.sellItem).toHaveBeenCalledTimes(1));
    expect(api.sellItem.mock.calls[0][1]).toMatchObject({ saleStoreId: 5, salePriceCents: 125000 });
  });
});

describe('SellItemModal: seletor de unidade', () => {
  const units: ItemView[] = [
    makeItem({ id: 1, floatValue: 0.11, tradeLock: LOCKED }),
    makeItem({ id: 2, floatValue: 0.22 }),
    makeItem({ id: 3, floatValue: 0.33, saleState: 'OFF_SALE' }),
    makeItem({ id: 4, floatValue: 0.44, status: 'VENDIDO' }),
  ];

  test('o padrão é a unidade recebida; holding é vendável e marcado; vendida não aparece', () => {
    renderSell({ item: units[1], units });
    const select = screen.getByLabelText('Unit') as HTMLSelectElement;
    expect(select).toHaveValue('2');
    const options = Array.from(select.options);
    expect(options.map((o) => o.value)).toEqual(['1', '2', '3']);
    expect(options[2]).toBeEnabled();
    expect(options[2].textContent).toMatch(/Holding/);
    expect(options[0]).toBeDisabled();
    expect(options[0].textContent).toMatch(/Trade locked until/);
    expect(options[1].textContent).toMatch(/Float 0\.22/i);
  });

  test('vender a unidade do holding envia o id dela', async () => {
    api.sellItem.mockResolvedValue(sold());
    renderSell({ item: units[1], units });
    await userEvent.selectOptions(screen.getByLabelText('Unit'), '3');
    await userEvent.type(screen.getByLabelText(/Sale price/), '1.25');
    await userEvent.click(screen.getByRole('button', { name: 'Record sale' }));
    await waitFor(() => expect(api.sellItem).toHaveBeenCalledTimes(1));
    expect(api.sellItem.mock.calls[0][0]).toBe(3);
  });

  test('uma só unidade em estoque (as outras vendidas) não mostra seletor', () => {
    renderSell({ item: units[1], units: [units[1], units[3]] });
    expect(screen.queryByLabelText('Unit')).not.toBeInTheDocument();
  });
});

describe('SellItemModal: foco (D118)', () => {
  test('ao cancelar, o foco volta ao botão que abriu o diálogo', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Vender linha</button>
          {open && <SellItemModal item={makeItem({ id: 1 })} stores={ALL_STORES} onClose={() => setOpen(false)} onSold={vi.fn()} onGone={vi.fn()} />}
        </>
      );
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderUi(<Harness />, { client });
    const trigger = screen.getByRole('button', { name: 'Vender linha' });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
