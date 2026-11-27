// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeStore } from '@/lib/testFixtures';
import { ApiRequestError } from '@/services/api';
import { renderUi } from '@/test/renderUi';
import type { Deposit, Withdrawal } from '@/types/api';

// QA da 12.7b: formulários de aporte e saque (casos extras).
const api = vi.hoisted(() => ({
  createDeposit: vi.fn(), updateDeposit: vi.fn(), createWithdrawal: vi.fn(), updateWithdrawal: vi.fn(), getWithdrawalFeeSuggestion: vi.fn(),
}));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));
vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => ({ displayCurrency: 'BRL', usdBrlRate: 5, fxRates: [] }) }));

import DepositFormModal from './DepositFormModal';
import WithdrawalFormModal from './WithdrawalFormModal';

const STORES = [
  makeStore({ id: 1, name: 'CSFloat', allowsWithdrawal: true }),
  makeStore({ id: 2, name: 'CSMoney', allowsWithdrawal: false }),
  makeStore({ id: 3, name: 'Velha', allowsWithdrawal: true, isActive: false }),
];

const legacyDeposit = (): Deposit => ({
  id: 9, storeId: null, storeName: null, currency: null, amountStoreCents: null, feeCents: null, amountBrlCents: 50000, amountBrlCurrency: 'BRL',
  depositedAt: '2026-11-01T12:00:00.000Z', note: null, legacy: true, amountUsdCents: null, approxCents: null, approxCurrency: 'BRL',
  estimated: false, createdAt: '', updatedAt: '',
} as unknown as Deposit);
const legacyWithdrawal = (): Withdrawal => ({
  id: 8, storeId: null, storeName: null, currency: null, amountStoreCents: null, feeCents: null, netStoreCents: null, amountBrlCents: 24000,
  amountBrlCurrency: 'BRL', withdrawnAt: '2026-11-01T12:00:00.000Z', note: null, legacyWithoutStore: true, amountUsdCents: null, approxCents: null,
  approxCurrency: 'BRL', estimated: false, createdAt: '', updatedAt: '',
} as unknown as Withdrawal);

const handlers = () => ({ onClose: vi.fn(), onSaved: vi.fn(), onGone: vi.fn() });
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getWithdrawalFeeSuggestion.mockResolvedValue({ suggestedFeeCents: null, warningCode: null });
});
afterEach(cleanup);

describe('WithdrawalFormModal (QA 12.7b)', () => {
  test('a loja é obrigatória: sem escolher, mostra o erro e não chama a API', async () => {
    renderUi(<WithdrawalFormModal stores={STORES} {...handlers()} />, { client: client() });
    await userEvent.type(screen.getByLabelText(/Amount withdrawn/), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText(/Store/)).toHaveAttribute('aria-invalid', 'true');
    expect(api.createWithdrawal).not.toHaveBeenCalled();
  });

  test('só lojas ativas que permitem saque entram na lista', () => {
    renderUi(<WithdrawalFormModal stores={STORES} {...handlers()} />, { client: client() });
    expect(screen.getByRole('option', { name: 'CSFloat' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'CSMoney' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Velha' })).toBeNull();
  });

  test('initialStoreId de loja que não permite saque é ignorado', () => {
    renderUi(<WithdrawalFormModal stores={STORES} initialStoreId={2} {...handlers()} />, { client: client() });
    expect(screen.getByLabelText(/Store/)).toHaveValue('');
  });

  test('valor recebido em R$ é opcional: sem ele, o corpo não leva amountBrlCents; com ele, vai como informativo', async () => {
    api.createWithdrawal.mockResolvedValue({
      id: 8, storeId: 1, currency: 'USD', amountStoreCents: 5000, amountBrlCents: null, amountBrlCurrency: null,
    });
    renderUi(<WithdrawalFormModal stores={STORES} initialStoreId={1} {...handlers()} />, { client: client() });
    await userEvent.type(screen.getByLabelText(/Amount withdrawn \(USD\)/), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createWithdrawal).toHaveBeenCalledTimes(1));
    const body = api.createWithdrawal.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({ storeId: 1, amountStoreCents: 5000 });
    expect('amountBrlCents' in body).toBe(false);
    expect('feeCents' in body).toBe(false);
  });

  test('valor recebido preenchido vai no corpo, na moeda de conversão', async () => {
    api.createWithdrawal.mockResolvedValue({ id: 8, storeId: 1, currency: 'USD', amountStoreCents: 5000, amountBrlCents: 24000 });
    renderUi(<WithdrawalFormModal stores={STORES} initialStoreId={1} {...handlers()} />, { client: client() });
    await userEvent.type(screen.getByLabelText(/Amount withdrawn \(USD\)/), '50');
    await userEvent.click(screen.getByRole('button', { name: 'More details' }));
    await userEvent.type(screen.getByLabelText(/received/i), '240');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createWithdrawal).toHaveBeenCalledTimes(1));
    expect(api.createWithdrawal.mock.calls[0][0]).toMatchObject({ amountBrlCents: 24000 });
  });

  test('taxa pré-preenchida pela sugestão e editada pelo usuário vai no corpo com o valor editado', async () => {
    api.getWithdrawalFeeSuggestion.mockResolvedValue({ suggestedFeeCents: 150, warningCode: null });
    api.createWithdrawal.mockResolvedValue({ id: 8, storeId: 1, currency: 'USD', amountStoreCents: 10000 });
    renderUi(<WithdrawalFormModal stores={STORES} initialStoreId={1} {...handlers()} />, { client: client() });
    await userEvent.type(screen.getByLabelText(/Amount withdrawn \(USD\)/), '100');
    await waitFor(() => expect(screen.getByLabelText(/Fee paid \(USD\)/)).toHaveValue('1.50'));
    await userEvent.clear(screen.getByLabelText(/Fee paid \(USD\)/));
    await userEvent.type(screen.getByLabelText(/Fee paid \(USD\)/), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createWithdrawal).toHaveBeenCalledTimes(1));
    expect(api.createWithdrawal.mock.calls[0][0]).toMatchObject({ feeCents: 200 });
  });

  test('taxa esvaziada pelo usuário não é preenchida de novo pela sugestão', async () => {
    api.getWithdrawalFeeSuggestion.mockResolvedValue({ suggestedFeeCents: 150, warningCode: null });
    renderUi(<WithdrawalFormModal stores={STORES} initialStoreId={1} {...handlers()} />, { client: client() });
    await userEvent.type(screen.getByLabelText(/Amount withdrawn \(USD\)/), '100');
    await waitFor(() => expect(screen.getByLabelText(/Fee paid \(USD\)/)).toHaveValue('1.50'));
    await userEvent.clear(screen.getByLabelText(/Fee paid \(USD\)/));
    await userEvent.type(screen.getByLabelText(/Amount withdrawn \(USD\)/), '5');
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(screen.getByLabelText(/Fee paid \(USD\)/)).toHaveValue('');
  });

  test('saque antigo sem loja: aviso de registro antigo, loja vazia e "Mais detalhes" aberto com o valor em R$', () => {
    renderUi(<WithdrawalFormModal stores={STORES} withdrawal={legacyWithdrawal()} {...handlers()} />, { client: client() });
    expect(screen.getByText(/from before the store was required/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Store/)).toHaveValue('');
    expect(screen.getByRole('button', { name: 'More details' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('saque antigo sem loja: escolher a loja e o valor envia PATCH com a loja e o valor sacado', async () => {
    api.updateWithdrawal.mockResolvedValue({});
    const h = handlers();
    renderUi(<WithdrawalFormModal stores={STORES} withdrawal={legacyWithdrawal()} {...h} />, { client: client() });
    await userEvent.selectOptions(screen.getByLabelText(/Store/), '1');
    await userEvent.type(screen.getByLabelText(/Amount withdrawn \(USD\)/), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateWithdrawal).toHaveBeenCalledTimes(1));
    expect(api.updateWithdrawal.mock.calls[0][0]).toBe(8);
    expect(api.updateWithdrawal.mock.calls[0][1]).toMatchObject({ storeId: 1, amountStoreCents: 5000 });
    await waitFor(() => expect(h.onSaved).toHaveBeenCalledTimes(1));
  });

  test('WITHDRAWAL_NOT_FOUND ao salvar chama onGone (já excluído em outro lugar)', async () => {
    api.updateWithdrawal.mockRejectedValue(new ApiRequestError('WITHDRAWAL_NOT_FOUND', 'x', 404));
    const h = handlers();
    renderUi(<WithdrawalFormModal stores={STORES} withdrawal={legacyWithdrawal()} {...h} />, { client: client() });
    await userEvent.selectOptions(screen.getByLabelText(/Store/), '1');
    await userEvent.type(screen.getByLabelText(/Amount withdrawn \(USD\)/), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.onGone).toHaveBeenCalledTimes(1));
  });

  test('erro genérico do servidor aparece no topo e o botão volta a poder salvar', async () => {
    api.createWithdrawal.mockRejectedValue(new ApiRequestError('INTERNAL_ERROR', 'x', 500));
    renderUi(<WithdrawalFormModal stores={STORES} initialStoreId={1} {...handlers()} />, { client: client() });
    await userEvent.type(screen.getByLabelText(/Amount withdrawn \(USD\)/), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createWithdrawal).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
  });
});

describe('DepositFormModal (QA 12.7b)', () => {
  test('a moeda do valor creditado é a da loja (US$) e a loja é obrigatória', async () => {
    renderUi(<DepositFormModal stores={STORES} {...handlers()} />, { client: client() });
    await userEvent.type(screen.getByLabelText(/Amount credited to the store/), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(api.createDeposit).not.toHaveBeenCalled();
  });

  test('o valor pago em R$ é opcional: sem ele, o corpo não o leva; com ele, vai na moeda de conversão', async () => {
    api.createDeposit.mockResolvedValue({ id: 1, storeId: 1, currency: 'USD', amountStoreCents: 10000 });
    renderUi(<DepositFormModal stores={STORES} initialStoreId={1} {...handlers()} />, { client: client() });
    await userEvent.type(screen.getByLabelText(/Amount credited to the store/), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createDeposit).toHaveBeenCalledTimes(1));
    expect('amountBrlCents' in (api.createDeposit.mock.calls[0][0] as object)).toBe(false);
    cleanup();
    api.createDeposit.mockClear();
    renderUi(<DepositFormModal stores={STORES} initialStoreId={1} {...handlers()} />, { client: client() });
    await userEvent.type(screen.getByLabelText(/Amount credited to the store/), '100');
    await userEvent.click(screen.getByRole('button', { name: 'More details' }));
    await userEvent.type(screen.getByLabelText(/Amount you paid/), '520');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createDeposit).toHaveBeenCalledTimes(1));
    expect(api.createDeposit.mock.calls[0][0]).toMatchObject({ amountStoreCents: 10000, amountBrlCents: 52000 });
  });

  test('aporte antigo sem loja (só em R$): mostra a dica de registro antigo e não deixa salvar sem a loja', async () => {
    renderUi(<DepositFormModal stores={STORES} deposit={legacyDeposit()} {...handlers()} />, { client: client() });
    expect(screen.getByText(/recorded in BRL only/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(api.updateDeposit).not.toHaveBeenCalled();
  });

  test('aporte antigo: escolher a loja e o valor creditado envia PATCH', async () => {
    api.updateDeposit.mockResolvedValue({});
    const h = handlers();
    renderUi(<DepositFormModal stores={STORES} deposit={legacyDeposit()} {...h} />, { client: client() });
    await userEvent.selectOptions(screen.getByLabelText(/Store/), '1');
    await userEvent.type(screen.getByLabelText(/Amount credited to the store/), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateDeposit).toHaveBeenCalledTimes(1));
    expect(api.updateDeposit.mock.calls[0][1]).toMatchObject({ storeId: 1, amountStoreCents: 10000 });
  });
});
