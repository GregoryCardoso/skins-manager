// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeStore } from '@/lib/testFixtures';
import { makeBalance, makeProfit } from '@/test/profitFixtures';
import { renderUi, setViewport } from '@/test/renderUi';
import type { CurrentStoreBalances, DepositList, WithdrawalList } from '@/types/api';

const api = vi.hoisted(() => ({
  getProfitSummary: vi.fn(), listStores: vi.fn(), listDeposits: vi.fn(), listWithdrawals: vi.fn(), getCurrentStoreBalances: vi.fn(),
  getCsfloatIntegration: vi.fn(), listStoreBalances: vi.fn(), deleteStoreBalanceEntry: vi.fn(), getWithdrawalFeeSuggestion: vi.fn(),
  createDeposit: vi.fn(), createWithdrawal: vi.fn(),
}));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));
vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => ({ displayCurrency: 'BRL', usdBrlRate: 5, fxRates: [] }) }));
vi.mock('@/components/ImportButton', () => ({ default: () => null }));
vi.mock('@/components/useMarketSummary', () => ({ useMarketSummary: () => ({ summary: null }) }));

import ProfitPage from './page';

const STORES = [
  makeStore({ id: 1, name: 'CSFloat', allowsWithdrawal: true }),
  makeStore({ id: 3, name: 'Steam', currency: 'BRL' }),
  makeStore({ id: 5, name: 'Mercado', allowsWithdrawal: false }),
];
const deposits = (): DepositList => ({
  deposits: [{
    id: 9, storeId: 1, storeName: 'CSFloat', currency: 'USD', amountStoreCents: 10000, feeCents: null, amountBrlCents: null,
    depositedAt: '2026-11-01T12:00:00.000Z', note: null, legacy: false, amountUsdCents: 10000, approxCents: 50000, approxCurrency: 'BRL',
    estimated: false, createdAt: '', updatedAt: '',
  }],
  totals: { count: 1, legacyCount: 0, amountUsdCents: 10000, approxCents: 50000, approxCurrency: 'BRL', estimated: false, feeCents: 0, feeMissingCount: 0 },
});
const withdrawals = (): WithdrawalList => ({
  withdrawals: [{
    id: 8, storeId: 1, storeName: 'CSFloat', currency: 'USD', amountStoreCents: 5000, feeCents: 100, netStoreCents: 4900, amountBrlCents: null,
    withdrawnAt: '2026-11-01T12:00:00.000Z', note: null, legacyWithoutStore: false, amountUsdCents: 4900, approxCents: 24500, approxCurrency: 'BRL',
    estimated: false, createdAt: '', updatedAt: '',
  }],
  totals: { count: 1, legacyCount: 0, withoutFeeCount: 0, netUsdCents: 4900, approxCents: 24500, approxCurrency: 'BRL', estimated: false },
});
const balances = (): CurrentStoreBalances => ({
  stores: [makeBalance({ storeId: 1, storeName: 'CSFloat' }), makeBalance({ storeId: 5, storeName: 'Mercado', allowsWithdrawal: false })],
  totals: {
    availableUsdCents: 150000, pendingUsdCents: 0, nonWithdrawableUsdCents: 75000, availableEstimated: false, pendingEstimated: false,
    nonWithdrawableEstimated: false, approxCurrency: 'BRL', approx: { available: 750000, pending: 0, nonWithdrawable: 375000 },
    nextReleaseAt: null, estimated: false,
  },
  usdBrlRate: 5, computedAt: '2026-11-27T10:00:00.000Z',
});

function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  renderUi(<ProfitPage />, { client, withToast: true });
  return client;
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getProfitSummary.mockResolvedValue(makeProfit());
  api.listStores.mockResolvedValue(STORES);
  api.listDeposits.mockResolvedValue(deposits());
  api.listWithdrawals.mockResolvedValue(withdrawals());
  api.getCurrentStoreBalances.mockResolvedValue(balances());
  api.getCsfloatIntegration.mockResolvedValue({ hasApiKey: false, storeId: 1 });
  api.getWithdrawalFeeSuggestion.mockResolvedValue({ suggestedFeeCents: null, warningCode: null });
  setViewport(1440, 900);
  window.history.replaceState(null, '', '/profit/');
});
afterEach(cleanup);

describe('página Lucro real (12.7b)', () => {
  test('mostra a equação, o painel de saldos, a faixa e as duas abas', async () => {
    renderPage();
    expect((await screen.findAllByText('Real profit')).length).toBeGreaterThan(0);
    expect(await screen.findByText('CSFloat', { selector: 'strong' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  test('?tab=withdrawals abre a aba de saques', async () => {
    window.history.replaceState(null, '', '/profit/?tab=withdrawals');
    renderPage();
    await waitFor(() => expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true'));
  });

  test('?tab= com valor inválido cai em Aportes', async () => {
    window.history.replaceState(null, '', '/profit/?tab=xyz');
    renderPage();
    await screen.findByText('CSFloat', { selector: 'strong' });
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
  });

  test('trocar de aba grava ?tab= na URL; voltar aos aportes limpa a URL sem perder outros parâmetros', async () => {
    window.history.replaceState(null, '', '/profit/?a=1');
    renderPage();
    await screen.findByText('CSFloat', { selector: 'strong' });
    await userEvent.click(screen.getAllByRole('tab')[1]);
    expect(window.location.search).toBe('?a=1&tab=withdrawals');
    await userEvent.click(screen.getAllByRole('tab')[0]);
    expect(window.location.search).toBe('?a=1');
  });

  test('o botão do cabeçalho abre o aporte sem loja; o da linha abre com a loja escolhida', async () => {
    renderPage();
    await screen.findByText('CSFloat', { selector: 'strong' });
    await userEvent.click(screen.getAllByRole('button', { name: 'New deposit' })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Store/)).toHaveValue('');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const row = document.querySelector('[data-store-id="1"]') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Record deposit' }));
    expect(within(await screen.findByRole('dialog')).getByLabelText(/Store/)).toHaveValue('1');
  });

  test('loja que não permite saque não tem o botão de saque na linha; a que permite tem', async () => {
    renderPage();
    await screen.findByText('Mercado', { selector: 'strong' });
    const rowNo = document.querySelector('[data-store-id="5"]') as HTMLElement;
    const rowYes = document.querySelector('[data-store-id="1"]') as HTMLElement;
    expect(within(rowNo).queryByRole('button', { name: 'Record withdrawal' })).toBeNull();
    expect(within(rowYes).getByRole('button', { name: 'Record withdrawal' })).toBeInTheDocument();
  });

  test('abaixo de 900 px, aporte e saque vão para o Menu da loja', async () => {
    setViewport(800, 600);
    renderPage();
    await screen.findByText('CSFloat', { selector: 'strong' });
    const row = document.querySelector('[data-store-id="1"]') as HTMLElement;
    expect(within(row).queryByRole('button', { name: 'Record deposit' })).toBeNull();
    await userEvent.click(within(row).getByRole('button', { name: 'More actions for CSFloat' }));
    expect(await screen.findByRole('menuitem', { name: 'Record deposit' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Record withdrawal' }));
    expect(within(await screen.findByRole('dialog')).getByLabelText(/Store/)).toHaveValue('1');
  });

  test('o formulário de saque da página só lista lojas que permitem saque', async () => {
    renderPage();
    await screen.findByText('CSFloat', { selector: 'strong' });
    await userEvent.click(screen.getAllByRole('button', { name: 'New withdrawal' })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('option', { name: 'CSFloat' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: 'Mercado' })).toBeNull();
    expect(within(dialog).queryByRole('option', { name: 'Steam' })).toBeNull();
  });

  test('salvar um aporte recarrega o resumo, fecha o diálogo e mostra o aviso (invalidação da 8.7)', async () => {
    api.createDeposit.mockResolvedValue(deposits().deposits[0]);
    renderPage();
    await screen.findByText('CSFloat', { selector: 'strong' });
    await userEvent.click(screen.getAllByRole('button', { name: 'New deposit' })[0]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Store/), '1');
    await userEvent.type(within(dialog).getByLabelText(/Amount credited to the store/), '100');
    const summaryCalls = api.getProfitSummary.mock.calls.length;
    const balanceCalls = api.getCurrentStoreBalances.mock.calls.length;
    const depositCalls = api.listDeposits.mock.calls.length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createDeposit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.getProfitSummary.mock.calls.length).toBeGreaterThan(summaryCalls));
    await waitFor(() => expect(api.getCurrentStoreBalances.mock.calls.length).toBeGreaterThan(balanceCalls));
    await waitFor(() => expect(api.listDeposits.mock.calls.length).toBeGreaterThan(depositCalls));
    expect(await screen.findByText('Deposit of $100.00 recorded.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('falha ao carregar o resumo: ErrorState com tentar de novo que recarrega', async () => {
    api.getProfitSummary.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    const retry = await screen.findByRole('button', { name: 'Try again' });
    await userEvent.click(retry);
    expect((await screen.findAllByText('Real profit')).length).toBeGreaterThan(0);
  });
});
