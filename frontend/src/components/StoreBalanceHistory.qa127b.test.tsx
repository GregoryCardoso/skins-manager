// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { makeBalance } from '@/test/profitFixtures';
import { renderUi } from '@/test/renderUi';
import type { StoreBalanceEntry } from '@/types/api';

// QA da 12.7b: histórico de conferências (excluir com confirmação, invalidação), conferência (erros do servidor) e linha da loja.
const api = vi.hoisted(() => ({
  listStoreBalances: vi.fn(), deleteStoreBalanceEntry: vi.fn(), createStoreBalanceCheck: vi.fn(), getStoreBalanceCheckPreview: vi.fn(),
  checkCsfloatBalance: vi.fn(), explainCsfloatBalance: vi.fn(),
}));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));

import BalanceCheckDialog from './BalanceCheckDialog';
import StoreBalanceHistory from './StoreBalanceHistory';
import StoreBalanceRow from './StoreBalanceRow';

const entry = (id: number, extra: Partial<StoreBalanceEntry> = {}): StoreBalanceEntry => ({
  id, storeId: 1, storeName: 'CSFloat', currency: 'USD', kind: 'CHECK', balanceCents: 75000, computedCents: 74000, differenceCents: 1000,
  adjustmentCents: 1000, note: 'taxa', legacy: false, recordedAt: '2026-11-20T12:00:00.000Z', createdAt: '', ...extra,
});
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.listStoreBalances.mockResolvedValue({ balances: [entry(11), entry(12, { differenceCents: 0, adjustmentCents: null, note: null })] });
  api.deleteStoreBalanceEntry.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('StoreBalanceHistory (QA 12.7b)', () => {
  test('lista os registros e mostra o vazio quando não há nenhum', async () => {
    const client = newClient();
    renderUi(<StoreBalanceHistory store={makeBalance()} onClose={vi.fn()} />, { client });
    expect(await screen.findAllByRole('button', { name: /Actions|More actions|Row actions/i })).not.toHaveLength(0);
    cleanup();
    api.listStoreBalances.mockResolvedValue({ balances: [] });
    renderUi(<StoreBalanceHistory store={makeBalance()} onClose={vi.fn()} />, { client: newClient() });
    expect(await screen.findByText('No balance record for this store.')).toBeInTheDocument();
  });

  test('excluir pede confirmação; cancelar não chama a API; confirmar exclui e recarrega o histórico e os saldos', async () => {
    const client = newClient();
    client.setQueryData(['storeBalances', 'current'], {});
    renderUi(<StoreBalanceHistory store={makeBalance()} onClose={vi.fn()} />, { client });
    const menus = await screen.findAllByRole('button', { name: /^Actions|More actions|Row actions|Actions for/i });
    await userEvent.click(menus[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(await screen.findByText(/Delete this record\?/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
    await waitFor(() => expect(screen.queryByText(/Delete this record\?/)).toBeNull());
    expect(api.deleteStoreBalanceEntry).not.toHaveBeenCalled();

    const callsBefore = api.listStoreBalances.mock.calls.length;
    await userEvent.click((await screen.findAllByRole('button', { name: /Actions|More actions|Row actions/i }))[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete record' }));
    await waitFor(() => expect(api.deleteStoreBalanceEntry).toHaveBeenCalledTimes(1));
    expect(api.deleteStoreBalanceEntry.mock.calls[0][0]).toBe(11);
    await waitFor(() => expect(api.listStoreBalances.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(client.getQueryState(['storeBalances', 'current'])?.isInvalidated).toBe(true);
  });

  test('registro já excluído em outro lugar (STORE_BALANCE_NOT_FOUND): sem erro na tela, só recarrega', async () => {
    api.deleteStoreBalanceEntry.mockRejectedValue(new ApiRequestError('STORE_BALANCE_NOT_FOUND', 'x', 404));
    renderUi(<StoreBalanceHistory store={makeBalance()} onClose={vi.fn()} />, { client: newClient() });
    await userEvent.click((await screen.findAllByRole('button', { name: /Actions|More actions|Row actions/i }))[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete record' }));
    await waitFor(() => expect(api.deleteStoreBalanceEntry).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete record' })).toBeNull());
    expect(screen.queryByText(/not found/i)).toBeNull();
  });

  test('falha ao carregar: ErrorState com tentar de novo', async () => {
    api.listStoreBalances.mockRejectedValueOnce(new Error('boom'));
    renderUi(<StoreBalanceHistory store={makeBalance()} onClose={vi.fn()} />, { client: newClient() });
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.listStoreBalances).toHaveBeenCalledTimes(2));
  });
});

describe('BalanceCheckDialog (QA 12.7b, erros do servidor)', () => {
  const preview = (difference: number) => ({
    storeId: 1, currency: 'USD', recordedAt: '2026-11-27T12:00:00.000Z', balanceCents: 75000, computedCents: 75000 - difference,
    differenceCents: difference, differenceUsdCents: difference, differenceApproxCents: difference * 5, approxCurrency: 'BRL', estimated: false,
  });
  async function toStep2(difference = 0) {
    api.getStoreBalanceCheckPreview.mockResolvedValue(preview(difference));
    renderUi(<BalanceCheckDialog store={makeBalance()} onClose={vi.fn()} onSaved={vi.fn()} />, { client: newClient() });
    await userEvent.type(screen.getByLabelText(/Real balance \(USD\)/), '750');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Step 2 of 2');
    await screen.findByText(difference === 0 ? 'Matches the calculated balance.' : 'Calculated by the app');
    if (difference !== 0) await screen.findByRole('radio', { name: /Adjust the app's balance/ });
  }

  test('RECORDED_AT_IN_FUTURE volta ao passo 1 com o erro no campo da data', async () => {
    api.createStoreBalanceCheck.mockRejectedValue(new ApiRequestError('RECORDED_AT_IN_FUTURE', 'x', 400));
    await toStep2(0);
    await userEvent.click(await screen.findByRole('button', { name: 'Record check' }));
    await waitFor(() => expect(screen.getByText('Step 1 of 2')).toBeInTheDocument());
    expect(screen.getByLabelText(/Check date/)).toHaveAttribute('aria-invalid', 'true');
  });

  test('ADJUSTMENT_NOTE_REQUIRED do servidor fica no passo 2, no campo da observação', async () => {
    api.createStoreBalanceCheck.mockRejectedValue(new ApiRequestError('ADJUSTMENT_NOTE_REQUIRED', 'x', 400));
    await toStep2(1000);
    await userEvent.type(await screen.findByLabelText(/Adjustment note/), 'algo');
    await userEvent.click(screen.getByRole('button', { name: 'Record check and adjustment' }));
    await waitFor(() => expect(api.createStoreBalanceCheck).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
  });

  test('erro genérico do servidor mantém o passo 2 e deixa tentar de novo', async () => {
    api.createStoreBalanceCheck.mockRejectedValue(new ApiRequestError('INTERNAL_ERROR', 'x', 500));
    await toStep2(0);
    await userEvent.click(await screen.findByRole('button', { name: 'Record check' }));
    await waitFor(() => expect(api.createStoreBalanceCheck).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record check' })).toBeEnabled());
  });

  test('salvar a conferência invalida saldos e resumo do lucro', async () => {
    api.createStoreBalanceCheck.mockResolvedValue({ id: 5, adjustmentCents: null });
    const client = newClient();
    client.setQueryData(['storeBalances', 'current'], {});
    client.setQueryData(['profitSummary'], {});
    api.getStoreBalanceCheckPreview.mockResolvedValue(preview(0));
    renderUi(<BalanceCheckDialog store={makeBalance()} onClose={vi.fn()} onSaved={vi.fn()} />, { client });
    await userEvent.type(screen.getByLabelText(/Real balance \(USD\)/), '750');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Matches the calculated balance.');
    await userEvent.click(await screen.findByRole('button', { name: 'Record check' }));
    await waitFor(() => expect(api.createStoreBalanceCheck).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(client.getQueryState(['profitSummary'])?.isInvalidated).toBe(true));
    expect(client.getQueryState(['storeBalances', 'current'])?.isInvalidated).toBe(true);
  });
});

describe('StoreBalanceRow (QA 12.7b)', () => {
  const renderRow = (store = makeBalance()) =>
    renderUi(
      <ul>
        <StoreBalanceRow store={store} scaleMaxCents={100000} canDeposit canWithdraw onDeposit={vi.fn()} onWithdraw={vi.fn()} onCheck={vi.fn()} onHistory={vi.fn()} />
      </ul>,
    );

  test('disponível negativo com pendente: a barra tem largura 0 no disponível e o pendente continua listrado', () => {
    renderRow(makeBalance({
      availableCents: -1500, availableUsdCents: -1500, negative: true, warningCode: 'COMPUTED_BALANCE_NEGATIVE',
      pending: { cents: 20000, count: 1, nextReleaseAt: '2026-12-01T12:00:00.000Z', usdCents: 20000, approxCents: 100000, estimated: false },
    }));
    const bar = screen.getByRole('img', { name: /Available/ });
    const [available, pending] = Array.from(bar.querySelectorAll('i')) as HTMLElement[];
    expect(available.style.width).toBe('0%');
    expect(pending.style.width).toBe('20%');
  });

  test('moeda sem casas decimais (JPY): saldo sem centavos e a barra usa o valor em US$', () => {
    renderRow(makeBalance({
      storeName: 'Yen shop', currency: 'JPY', availableCents: 150000, availableUsdCents: 100000, availableApproxCents: null, approxCurrency: undefined,
      pending: { cents: 0, count: 0, nextReleaseAt: null, usdCents: 0, approxCents: null, estimated: false },
    }));
    expect(screen.getAllByText('¥1,500').length).toBeGreaterThan(0);
    expect(screen.queryByText(/1,500\.\d\d/)).toBeNull();
    const bar = screen.getByRole('img', { name: /Available/ });
    expect((bar.querySelector('i') as HTMLElement).style.width).toBe('100%');
  });
});
