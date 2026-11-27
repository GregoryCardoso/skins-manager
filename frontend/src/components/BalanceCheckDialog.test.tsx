// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { makeBalance } from '@/test/profitFixtures';
import { renderUi } from '@/test/renderUi';
import type { StoreBalanceCheckPreview } from '@/types/api';

const api = vi.hoisted(() => ({ createStoreBalanceCheck: vi.fn(), getStoreBalanceCheckPreview: vi.fn(), checkCsfloatBalance: vi.fn(), explainCsfloatBalance: vi.fn() }));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));

import BalanceCheckDialog from './BalanceCheckDialog';

const preview = (difference: number): StoreBalanceCheckPreview => ({
  storeId: 1, currency: 'USD', recordedAt: '2026-11-27T12:00:00.000Z', balanceCents: 75000, computedCents: 75000 - difference,
  differenceCents: difference, differenceUsdCents: difference, differenceApproxCents: difference * 5, approxCurrency: 'BRL', estimated: false,
});

function renderCheck(props: Partial<React.ComponentProps<typeof BalanceCheckDialog>> = {}) {
  const handlers = { onClose: vi.fn(), onSaved: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderUi(<BalanceCheckDialog store={makeBalance()} {...handlers} {...props} />, { client });
  return handlers;
}

async function goToStep2(amount = '750') {
  await userEvent.type(screen.getByLabelText(/Real balance \(USD\)/), amount);
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getStoreBalanceCheckPreview.mockResolvedValue(preview(1000));
  api.createStoreBalanceCheck.mockResolvedValue({ id: 5, adjustmentCents: null });
});
afterEach(cleanup);

describe('BalanceCheckDialog (12.7b)', () => {
  test('a frase fixa e o passo 1; sem valor, o Continuar mostra o erro e não avança', async () => {
    renderCheck();
    expect(screen.getByText(/Check: you enter the balance you see on the site\. Adjustment:/)).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the balance');
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
  });

  test('passo 1 para 2: mostra calculado, real e diferença, e leva o foco ao título do passo', async () => {
    renderCheck();
    await goToStep2();
    expect(await screen.findByText('Calculated by the app')).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Compare' })).toHaveFocus();
    expect(await screen.findByText('+$10.00')).toBeInTheDocument();
  });

  test('diferença 0: sem escolha, uma ação só ("Registrar conferência") e o corpo sem ajuste', async () => {
    api.getStoreBalanceCheckPreview.mockResolvedValue(preview(0));
    const { onSaved } = renderCheck();
    await goToStep2();
    expect(await screen.findByText('Matches the calculated balance.')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Record check' }));
    await waitFor(() => expect(api.createStoreBalanceCheck).toHaveBeenCalledTimes(1));
    expect(api.createStoreBalanceCheck.mock.calls[0][0]).toMatchObject({ storeId: 1, balanceCents: 75000, adjust: false });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  test('diferença diferente de 0: dois rádios, observação só no ajuste e o rótulo do botão segue a escolha', async () => {
    renderCheck();
    await goToStep2();
    const adjust = await screen.findByRole('radio', { name: /Adjust the app's balance/ });
    const only = screen.getByRole('radio', { name: /Only record the check/ });
    expect(adjust).toBeChecked();
    expect(screen.getByLabelText(/Adjustment note/)).toBeRequired();
    expect(screen.getByRole('button', { name: 'Record check and adjustment' })).toBeInTheDocument();
    await userEvent.click(only);
    expect(screen.queryByLabelText(/Adjustment note/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Record check' })).toBeInTheDocument();
  });

  test('ajuste sem observação: o erro aparece no campo e nada é enviado; com observação, envia adjust true', async () => {
    api.createStoreBalanceCheck.mockResolvedValue({ id: 5, adjustmentCents: 1000 });
    const { onSaved } = renderCheck();
    await goToStep2();
    await screen.findByRole('radio', { name: /Adjust the app's balance/ });
    await userEvent.click(screen.getByRole('button', { name: 'Record check and adjustment' }));
    expect(await screen.findAllByText(/note/i)).not.toHaveLength(0);
    expect(api.createStoreBalanceCheck).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/Adjustment note/), 'fee not recorded');
    await userEvent.click(screen.getByRole('button', { name: 'Record check and adjustment' }));
    await waitFor(() => expect(api.createStoreBalanceCheck).toHaveBeenCalledTimes(1));
    expect(api.createStoreBalanceCheck.mock.calls[0][0]).toMatchObject({ adjust: true, note: 'fee not recorded' });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.stringContaining('adjustment of')));
  });

  test('BALANCE_CHECK_BEFORE_LAST volta ao passo 1 com o erro no campo da data', async () => {
    api.getStoreBalanceCheckPreview.mockResolvedValue(preview(0));
    api.createStoreBalanceCheck.mockRejectedValue(new ApiRequestError('BALANCE_CHECK_BEFORE_LAST', 'x', 409));
    renderCheck();
    await goToStep2();
    await screen.findByText('Matches the calculated balance.');
    await userEvent.click(screen.getByRole('button', { name: 'Record check' }));
    await waitFor(() => expect(screen.getByText('Step 1 of 2')).toBeInTheDocument());
    expect(screen.getByLabelText(/Check date/)).toHaveAttribute('aria-invalid', 'true');
  });

  test('Voltar mantém o texto digitado', async () => {
    renderCheck();
    await goToStep2('123.45');
    await screen.findByText('Calculated by the app');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText(/Real balance \(USD\)/)).toHaveValue('123.45');
  });

  test('Esc fecha o diálogo', async () => {
    const { onClose } = renderCheck();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('na loja do CSFloat, o saldo buscado preenche o campo (só leitura: nada é gravado)', async () => {
    api.checkCsfloatBalance.mockResolvedValue({
      csfloat: { balanceCents: 123456, pendingBalanceCents: 0 }, store: { availableCents: 100000, pendingCents: 0 },
      difference: { availableCents: 23456, pendingCents: 0 }, inTransit: { purchasesCents: 0, salesPendingCents: 0, openBidsCents: 0 },
      feeCheck: { saleFeeMatches: true }, explained: false, checkedAt: '2026-11-27T12:00:00.000Z',
    });
    renderCheck({ csfloat: true });
    await userEvent.click(screen.getByRole('button', { name: 'Check against CSFloat' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Use this balance' }));
    expect(screen.getByLabelText(/Real balance \(USD\)/)).toHaveValue('1234.56');
    expect(api.createStoreBalanceCheck).not.toHaveBeenCalled();
  });
});
