// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { renderUi } from '@/test/renderUi';
import type { Store } from '@/types/api';

const api = vi.hoisted(() => ({ listStores: vi.fn(), getSettings: vi.fn(), setSteamStore: vi.fn(), updateStore: vi.fn(), deleteStore: vi.fn() }));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));

import StoresPage from './page';

const store = (id: number, name: string, extra: Partial<Store> = {}): Store => ({
  id, name, currency: 'USD', isActive: true, isPrimary: id === 1, sellsHere: true, saleFeeType: 'DEDUCTED', saleFeeRate: 0.02, saleFeeRounding: 'CEIL',
  saleMinFeeCents: null, saleFixedFeeCents: 0, allowsWithdrawal: false, withdrawalFeeRate: null, withdrawalFixedFeeCents: 0, saleHoldDays: 0,
  createdAt: '', updatedAt: '', saleFeesConfigured: true, inUse: false, ...extra,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderUi(<StoresPage />, { client, withToast: true });
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.listStores.mockResolvedValue([store(1, 'CSFloat'), store(2, 'Steam'), store(3, 'CSMoney')]);
  api.getSettings.mockResolvedValue({ steamStoreId: null });
  api.setSteamStore.mockResolvedValue({});
  api.updateStore.mockResolvedValue({});
  api.deleteStore.mockResolvedValue({ id: 3 });
});
afterEach(cleanup);

describe('página de Lojas', () => {
  test('um cartão por loja, com a contagem no cabeçalho', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'CSFloat' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Steam' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'CSMoney' })).toBeInTheDocument();
    expect(screen.getByText('3 stores')).toBeInTheDocument();
  });

  test('dica da Steam enquanto nenhuma foi escolhida; "Choose" foca o menu do cartão da Steam', async () => {
    renderPage();
    const tip = await screen.findByText('Choose your Steam store');
    expect(tip).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Choose' }));
    expect(screen.getByRole('button', { name: 'More actions for Steam' })).toHaveFocus();
  });

  test('a dica some quando já há loja Steam escolhida', async () => {
    api.getSettings.mockResolvedValue({ steamStoreId: 2 });
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Steam' });
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled());
    expect(screen.queryByText('Choose your Steam store')).toBeNull();
  });

  test('escolher a loja Steam pelo menu chama a API e confirma num Toast', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for Steam' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Use as my Steam store' }));
    await waitFor(() => expect(api.setSteamStore).toHaveBeenCalledWith(2));
    expect(await screen.findByText('"Steam" is now your Steam store.')).toBeInTheDocument();
  });

  test('excluir pede confirmação (danger) e só então chama a API', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for CSMoney' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(api.deleteStore).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete store' }));
    await waitFor(() => expect(api.deleteStore).toHaveBeenCalledWith(3));
    expect(await screen.findByText('Store "CSMoney" deleted.')).toBeInTheDocument();
  });

  test('loja que sumiu (STORE_NOT_FOUND) avisa num Toast e recarrega a lista', async () => {
    api.updateStore.mockRejectedValue(new ApiRequestError('STORE_NOT_FOUND', 'x', 404));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'More actions for CSMoney' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Deactivate' }));
    expect(await screen.findByText('The store no longer exists. The list was refreshed.')).toBeInTheDocument();
  });

  test('erro de carregamento: ErrorState com "Try again"', async () => {
    api.listStores.mockRejectedValueOnce(new ApiRequestError('NETWORK_ERROR', 'x', 0));
    renderPage();
    expect(await screen.findByText(/Could not load the stores/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'CSFloat' })).toBeInTheDocument();
  });

  test('sem lojas: estado vazio com o botão de criar', async () => {
    api.listStores.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/You have no stores yet/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'New store' })[0]);
    expect(await screen.findByRole('dialog', { name: 'New store' })).toBeInTheDocument();
  });
});
