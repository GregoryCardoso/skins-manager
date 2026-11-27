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

const api = vi.hoisted(() => ({
  createDeposit: vi.fn(), updateDeposit: vi.fn(), createWithdrawal: vi.fn(), updateWithdrawal: vi.fn(), getWithdrawalFeeSuggestion: vi.fn(),
}));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));
vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => ({ displayCurrency: 'BRL', usdBrlRate: 5, fxRates: [] }) }));

import DepositFormModal from './DepositFormModal';
import WithdrawalFormModal from './WithdrawalFormModal';

const STORES = [
  makeStore({ id: 1, name: 'CSFloat', allowsWithdrawal: true }),
  makeStore({ id: 2, name: 'CSMoney', allowsWithdrawal: true }),
  makeStore({ id: 3, name: 'Steam', currency: 'BRL' }),
  makeStore({ id: 4, name: 'Yen shop', currency: 'JPY', allowsWithdrawal: true }),
];

const deposit = (extra: Partial<Deposit> = {}): Deposit => ({
  id: 9, storeId: 1, storeName: 'CSFloat', currency: 'USD', amountStoreCents: 10000, feeCents: null, amountBrlCents: null,
  depositedAt: '2026-11-01T12:00:00.000Z', note: null, legacy: false, amountUsdCents: 10000, approxCents: 50000, approxCurrency: 'BRL',
  estimated: false, createdAt: '', updatedAt: '', ...extra,
});
const withdrawal = (extra: Partial<Withdrawal> = {}): Withdrawal => ({
  id: 8, storeId: 1, storeName: 'CSFloat', currency: 'USD', amountStoreCents: 5000, feeCents: 100, netStoreCents: 4900, amountBrlCents: null,
  withdrawnAt: '2026-11-01T12:00:00.000Z', note: null, legacyWithoutStore: false, amountUsdCents: 4900, approxCents: 24500, approxCurrency: 'BRL',
  estimated: false, createdAt: '', updatedAt: '', ...extra,
});

const handlers = () => ({ onClose: vi.fn(), onSaved: vi.fn(), onGone: vi.fn() });
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getWithdrawalFeeSuggestion.mockResolvedValue({ suggestedFeeCents: null, warningCode: null });
});
afterEach(cleanup);

describe('DepositFormModal (12.7b)', () => {
  test('initialStoreId escolhe a loja; só lojas em US$ entram na lista', () => {
    renderUi(<DepositFormModal stores={STORES} initialStoreId={2} {...handlers()} />, { client: client() });
    expect(screen.getByLabelText(/Store/)).toHaveValue('2');
    expect(screen.queryByRole('option', { name: 'Steam' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Yen shop' })).toBeNull();
  });

  test('initialStoreId de loja que não aceita aporte é ignorado', () => {
    renderUi(<DepositFormModal stores={STORES} initialStoreId={3} {...handlers()} />, { client: client() });
    expect(screen.getByLabelText(/Store/)).toHaveValue('');
  });

  test('"Mais detalhes" fica fechado ao criar e aberto ao editar um registro com valor pago', async () => {
    renderUi(<DepositFormModal stores={STORES} {...handlers()} />, { client: client() });
    expect(screen.getByRole('button', { name: 'More details' })).toHaveAttribute('aria-expanded', 'false');
    cleanup();
    renderUi(<DepositFormModal stores={STORES} deposit={deposit({ amountBrlCents: 50000, amountBrlCurrency: 'BRL' })} {...handlers()} />, { client: client() });
    expect(screen.getByRole('button', { name: 'More details' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText(/Amount you paid/)).toBeInTheDocument();
  });

  test('erro no valor pago (em "Mais detalhes") abre a seção e o resumo foca o campo', async () => {
    renderUi(<DepositFormModal stores={STORES} initialStoreId={1} {...handlers()} />, { client: client() });
    await userEvent.type(screen.getByLabelText(/Amount credited to the store/), '10');
    await userEvent.click(screen.getByRole('button', { name: 'More details' }));
    await userEvent.type(screen.getByLabelText(/Amount you paid/), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'More details' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More details' })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: /Amount in the conversion currency/ }));
    expect(screen.getByLabelText(/Amount you paid/)).toHaveFocus();
  });

  test('salva com a loja pré-escolhida e entrega a mensagem', async () => {
    api.createDeposit.mockResolvedValue(deposit());
    const h = handlers();
    renderUi(<DepositFormModal stores={STORES} initialStoreId={1} {...h} />, { client: client() });
    await userEvent.type(screen.getByLabelText(/Amount credited to the store/), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createDeposit).toHaveBeenCalledTimes(1));
    expect(api.createDeposit.mock.calls[0][0]).toMatchObject({ storeId: 1, amountStoreCents: 10000 });
    await waitFor(() => expect(h.onSaved).toHaveBeenCalledWith('Deposit of $100.00 recorded.'));
  });
});

describe('WithdrawalFormModal (12.7b)', () => {
  test('initialStoreId escolhe a loja e o valor sacado usa a moeda dela', () => {
    renderUi(<WithdrawalFormModal stores={STORES} initialStoreId={2} {...handlers()} />, { client: client() });
    expect(screen.getByLabelText(/Store/)).toHaveValue('2');
    expect(screen.getByLabelText(/Amount withdrawn \(USD\)/)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Steam' })).toBeNull();
  });

  test('moeda sem casas decimais (JPY): digitar decimais dá erro de número inteiro', async () => {
    renderUi(<WithdrawalFormModal stores={STORES} initialStoreId={4} {...handlers()} />, { client: client() });
    const amount = screen.getByLabelText(/Amount withdrawn \(JPY\)/);
    await userEvent.type(amount, '1500.50');
    await userEvent.tab();
    expect(await screen.findByText(/JPY has no decimal places/)).toBeInTheDocument();
  });

  test('"Mais detalhes" fechado por padrão e aberto ao editar um saque com valor recebido', () => {
    renderUi(<WithdrawalFormModal stores={STORES} {...handlers()} />, { client: client() });
    expect(screen.getByRole('button', { name: 'More details' })).toHaveAttribute('aria-expanded', 'false');
    cleanup();
    renderUi(<WithdrawalFormModal stores={STORES} withdrawal={withdrawal({ amountBrlCents: 24000, amountBrlCurrency: 'BRL' })} {...handlers()} />, { client: client() });
    expect(screen.getByRole('button', { name: 'More details' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('taxa maior que o valor sacado: o erro do backend aparece no campo da taxa', async () => {
    api.createWithdrawal.mockRejectedValue(new ApiRequestError('FEE_EXCEEDS_AMOUNT', 'x', 400, { field: 'feeCents' }));
    renderUi(<WithdrawalFormModal stores={STORES} initialStoreId={1} {...handlers()} />, { client: client() });
    await userEvent.type(screen.getByLabelText(/Amount withdrawn \(USD\)/), '10');
    await userEvent.type(screen.getByLabelText(/Fee paid \(USD\)/), '20');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createWithdrawal).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText(/Fee paid \(USD\)/)).toHaveAttribute('aria-invalid', 'true'));
  });

  test('a taxa sugerida pelo backend preenche o campo e pode ser editada', async () => {
    api.getWithdrawalFeeSuggestion.mockResolvedValue({ suggestedFeeCents: 150, warningCode: null });
    renderUi(<WithdrawalFormModal stores={STORES} initialStoreId={1} {...handlers()} />, { client: client() });
    await userEvent.type(screen.getByLabelText(/Amount withdrawn \(USD\)/), '100');
    await waitFor(() => expect(screen.getByLabelText(/Fee paid \(USD\)/)).toHaveValue('1.50'));
    await userEvent.clear(screen.getByLabelText(/Fee paid \(USD\)/));
    await userEvent.type(screen.getByLabelText(/Fee paid \(USD\)/), '2');
    expect(screen.getByLabelText(/Fee paid \(USD\)/)).toHaveValue('2');
  });
});
