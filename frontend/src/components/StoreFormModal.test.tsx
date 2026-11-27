// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { renderUi } from '@/test/renderUi';
import type { Store } from '@/types/api';

const api = vi.hoisted(() => ({
  previewStoreFee: vi.fn(),
  createStore: vi.fn(),
  updateStore: vi.fn(),
}));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));

import StoreFormModal from './StoreFormModal';

const store = (extra: Partial<Store> = {}): Store => ({
  id: 7, name: 'CSFloat', currency: 'USD', isActive: true, isPrimary: false, saleFeeType: null, saleFeeRate: null,
  saleFeeRounding: 'CEIL', saleMinFeeCents: null, saleFixedFeeCents: 0, allowsWithdrawal: false, withdrawalFeeRate: null,
  withdrawalFixedFeeCents: 0, saleHoldDays: 0, createdAt: '', updatedAt: '', saleFeesConfigured: false, inUse: false, ...extra,
});

const renderModal = (props: Partial<React.ComponentProps<typeof StoreFormModal>> = {}) => {
  const handlers = { onClose: vi.fn(), onSaved: vi.fn(), onGone: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderUi(<StoreFormModal {...handlers} {...props} />, { client });
  return handlers;
};

beforeEach(() => {
  api.previewStoreFee.mockReset();
  api.createStore.mockReset();
  api.updateStore.mockReset();
  api.previewStoreFee.mockImplementation(async (query: { priceCents?: number | null; rate: number; currency: string }) => ({
    currency: query.currency, saleFeeType: 'DEDUCTED', priceCents: query.priceCents ?? 1000, feeCents: 20, netCents: 980,
  }));
});
afterEach(cleanup);

describe('exemplo ao vivo da taxa', () => {
  test('sem tipo e sem percentual: "taxas não configuradas", sem chamar a API', async () => {
    renderModal();
    expect(screen.getByText(/No sale fee set: the break-even price/)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(api.previewStoreFee).not.toHaveBeenCalled();
  });

  test('com tipo e percentual válidos chama a prévia (com debounce, uma vez) e mostra a frase do backend', async () => {
    renderModal();
    await userEvent.selectOptions(screen.getByLabelText('Fee type'), 'DEDUCTED');
    const rate = screen.getByLabelText('Rate (%)');
    await userEvent.type(rate, '2');
    // Digitar não dispara uma chamada por tecla: só depois de 300 ms parado.
    expect(api.previewStoreFee).not.toHaveBeenCalled();
    expect(await screen.findByText('On a sale of $10.00, the fee is $0.20 and you receive $9.80.')).toBeInTheDocument();
    expect(api.previewStoreFee).toHaveBeenCalledTimes(1);
    expect(api.previewStoreFee.mock.calls[0][0]).toEqual({
      currency: 'USD', saleFeeType: 'DEDUCTED', rate: 0.02, rounding: 'CEIL', minCents: null, fixedCents: 0, priceCents: null,
    });
    // o preço do exemplo vem do backend e aparece no campo
    expect(screen.getByLabelText(/Example price \(USD\)/)).toHaveValue('10.00');
  });

  test('ADDED usa a frase do comprador', async () => {
    api.previewStoreFee.mockResolvedValue({ currency: 'USD', saleFeeType: 'ADDED', priceCents: 1000, feeCents: 20, netCents: 1000 });
    renderModal();
    await userEvent.selectOptions(screen.getByLabelText('Fee type'), 'ADDED');
    await userEvent.type(screen.getByLabelText('Rate (%)'), '2');
    expect(await screen.findByText('The buyer pays $10.00, the fee is $0.20 and you receive $10.00.')).toBeInTheDocument();
  });

  test('editar o preço do exemplo refaz a prévia com o preço em centavos', async () => {
    renderModal();
    await userEvent.selectOptions(screen.getByLabelText('Fee type'), 'DEDUCTED');
    await userEvent.type(screen.getByLabelText('Rate (%)'), '2');
    await screen.findByText(/On a sale of \$10.00/);
    const price = screen.getByLabelText(/Example price/);
    await userEvent.clear(price);
    await userEvent.type(price, '1.25');
    await waitFor(() => expect(api.previewStoreFee.mock.calls.at(-1)?.[0]).toMatchObject({ priceCents: 125 }));
  });

  test('o erro da prévia fica discreto no exemplo e não bloqueia o salvar', async () => {
    api.previewStoreFee.mockRejectedValue(new ApiRequestError('NET_RECEIVED_NEGATIVE', 'x', 400));
    renderModal();
    await userEvent.selectOptions(screen.getByLabelText('Fee type'), 'DEDUCTED');
    await userEvent.type(screen.getByLabelText('Rate (%)'), '2');
    expect(await screen.findByText(/Could not calculate the example/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  test('sem tipo mas com percentual: pede o tipo (nada a calcular)', async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText('Rate (%)'), '2');
    expect(await screen.findByText('Choose the fee type and enter the rate to see an example.')).toBeInTheDocument();
    expect(api.previewStoreFee).not.toHaveBeenCalled();
  });
});

describe('moeda sem centavos', () => {
  test('JPY: "15,5" na taxa mínima dá erro depois do blur, e valor inteiro não', async () => {
    renderModal({ store: store({ currency: 'JPY' }) });
    const min = screen.getByLabelText(/Minimum fee/);
    await userEvent.type(min, '15.5');
    await userEvent.tab();
    expect(await screen.findByText(/JPY has no decimal places|¥ has no decimal places|no decimal places/)).toBeInTheDocument();
    await userEvent.clear(min);
    await userEvent.type(min, '15');
    await userEvent.tab();
    expect(screen.queryByText(/no decimal places\. Enter a whole number/)).toBeNull();
  });

  test('trocar a moeda para JPY revalida a precisão do que já estava digitado', async () => {
    renderModal();
    const min = screen.getByLabelText(/Minimum fee/);
    await userEvent.type(min, '0.30');
    await userEvent.tab();
    expect(screen.queryByText(/whole number/)).toBeNull();
    await userEvent.click(screen.getByRole('combobox', { name: 'Currency' }));
    await userEvent.click(await screen.findByRole('option', { name: /JPY/ }));
    expect(await screen.findByText(/no decimal places/)).toBeInTheDocument();
  });

  test('moeda travada quando a loja já foi usada, com a dica', () => {
    renderModal({ store: store({ inUse: true }) });
    expect(screen.getByRole('combobox', { name: 'Currency' })).toBeDisabled();
    expect(screen.getByText('The currency cannot change: the store was already used.')).toBeInTheDocument();
  });
});

describe('salvar', () => {
  test('sem nome: o resumo de erros aparece e o link leva ao campo', async () => {
    const { onSaved } = renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('Enter the store name.');
    await userEvent.click(screen.getByRole('button', { name: /Name: Enter the store name/ }));
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(api.createStore).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  test('erro de uma seção recolhida abre a seção (retenção inválida)', async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText('Name'), 'Minha loja');
    const hold = screen.queryByLabelText('Balance hold after a sale (days)');
    expect(hold).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Balance after a sale/ }));
    const field = await screen.findByLabelText('Balance hold after a sale (days)');
    await userEvent.clear(field);
    await userEvent.type(field, '99');
    await userEvent.click(screen.getByRole('button', { name: /Balance after a sale/ })); // recolhe
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByLabelText('Balance hold after a sale (days)')).toBeInTheDocument();
    expect(screen.getAllByText('Enter a whole number of days, from 0 to 30.').length).toBeGreaterThan(0);
  });

  test('cria a loja com o corpo da API (percentual vira fração; vazio vira null na mínima)', async () => {
    api.createStore.mockResolvedValue(store({ name: 'Nova' }));
    const { onSaved } = renderModal();
    await userEvent.type(screen.getByLabelText('Name'), 'Nova');
    await userEvent.selectOptions(screen.getByLabelText('Fee type'), 'DEDUCTED');
    await userEvent.type(screen.getByLabelText('Rate (%)'), '2.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Store "Nova" created.'));
    expect(api.createStore).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Nova', currency: 'USD', saleFeeType: 'DEDUCTED', saleFeeRate: 0.025, saleMinFeeCents: null, saleFixedFeeCents: 0, saleHoldDays: 0,
    }));
  });

  test('erro do servidor vai para o campo (nome repetido)', async () => {
    api.createStore.mockRejectedValue(new ApiRequestError('STORE_NAME_TAKEN', 'x', 409, { field: 'name' }));
    renderModal();
    await userEvent.type(screen.getByLabelText('Name'), 'CSFloat');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  });

  test('editar sem mudar nada só fecha (nenhuma chamada)', async () => {
    const { onClose } = renderModal({ store: store() });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClose).toHaveBeenCalled();
    expect(api.updateStore).not.toHaveBeenCalled();
  });

  test('loja que sumiu (STORE_NOT_FOUND ao editar) chama onGone', async () => {
    api.updateStore.mockRejectedValue(new ApiRequestError('STORE_NOT_FOUND', 'x', 404));
    const { onGone } = renderModal({ store: store() });
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'Outro nome');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onGone).toHaveBeenCalled());
  });
});
