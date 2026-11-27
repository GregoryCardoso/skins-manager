// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeItem } from '@/lib/testFixtures';
import { ApiRequestError } from '@/services/api';
import { renderUi } from '@/test/renderUi';
import type { UnsellPreview } from '@/types/api';

const api = vi.hoisted(() => ({ getUnsellPreview: vi.fn() }));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));

import UnsellDialog from './UnsellDialog';

const preview = (extra: Partial<UnsellPreview> = {}): UnsellPreview => ({
  itemId: 7, storeId: 1, storeName: 'CSFloat', storeCurrency: 'USD', balanceEffectCents: -1200, wasReleased: true, releasesAt: '2026-11-10T12:00:00.000Z',
  availableBeforeCents: 84210, availableAfterCents: 83010, pendingBeforeCents: 1900, pendingAfterCents: 1900, effectUsdCents: -1200,
  approxCents: -6520, approxCurrency: 'BRL', estimated: false, currencyMismatch: false, returnsTo: 'FOR_SALE', ...extra,
});

function renderDialog() {
  const handlers = { onConfirm: vi.fn(), onCancel: vi.fn(), onGone: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderUi(<UnsellDialog item={makeItem({ id: 7, status: 'VENDIDO' })} busy={false} error={null} {...handlers} />, { client });
  return handlers;
}

beforeEach(() => {
  api.getUnsellPreview.mockReset();
});
afterEach(cleanup);

describe('UnsellDialog', () => {
  test('carregando: mostra o indicador e o desfazer já está disponível', async () => {
    api.getUnsellPreview.mockReturnValue(new Promise(() => undefined));
    renderDialog();
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo sale' })).toBeEnabled();
  });

  test('venda liberada: sai do disponível, com o "≈", o antes e depois, e o item volta à venda', async () => {
    api.getUnsellPreview.mockResolvedValue(preview());
    renderDialog();
    expect(await screen.findByText(/leaves the available balance of CSFloat/)).toBeInTheDocument();
    expect(screen.getByText(/\$12\.00/)).toBeInTheDocument();
    expect(screen.getByText(/≈/)).toBeInTheDocument();
    expect(screen.getByText(/\$842\.10 → \$830\.10/)).toBeInTheDocument();
    expect(screen.getByText('The item goes back to stock, for sale.')).toBeInTheDocument();
    expect(screen.queryByText('The balance will be negative.')).not.toBeInTheDocument();
  });

  test('venda retida: sai do pendente', async () => {
    api.getUnsellPreview.mockResolvedValue(preview({ wasReleased: false, pendingBeforeCents: 1900, pendingAfterCents: 700, availableAfterCents: 84210 }));
    renderDialog();
    expect(await screen.findByText(/leaves the pending balance of CSFloat/)).toBeInTheDocument();
    expect(screen.getByText(/\$19\.00 → \$7\.00/)).toBeInTheDocument();
  });

  test('saldo disponível que fica negativo mostra o aviso; item do holding volta ao holding', async () => {
    api.getUnsellPreview.mockResolvedValue(preview({ availableAfterCents: -500, returnsTo: 'OFF_SALE' }));
    renderDialog();
    expect(await screen.findByText('The balance will be negative.')).toBeInTheDocument();
    expect(screen.getByText('The item goes back to stock, in holding.')).toBeInTheDocument();
  });

  test('sem efeito (moeda diferente da loja): diz que nenhum saldo muda e explica', async () => {
    api.getUnsellPreview.mockResolvedValue(preview({ balanceEffectCents: 0, currencyMismatch: true, approxCents: null }));
    renderDialog();
    expect(await screen.findByText('The balance of no store changes.')).toBeInTheDocument();
    expect(screen.getByText(/different currency from the store/)).toBeInTheDocument();
  });

  test('a prévia falhou: aviso com "Try again" e o desfazer continua possível', async () => {
    api.getUnsellPreview.mockRejectedValueOnce(new ApiRequestError('INTERNAL_ERROR', 'falhou', 500));
    api.getUnsellPreview.mockResolvedValueOnce(preview());
    const { onConfirm } = renderDialog();
    expect(await screen.findByText(/Couldn't work out the effect on the balance/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo sale' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/leaves the available balance of CSFloat/)).toBeInTheDocument();
    expect(api.getUnsellPreview).toHaveBeenCalledTimes(2);
  });

  test('item que sumiu ou já não está vendido (404/409): avisa o chamador para fechar', async () => {
    api.getUnsellPreview.mockRejectedValue(new ApiRequestError('ITEM_NOT_SOLD', 'não vendido', 409));
    const { onGone } = renderDialog();
    await waitFor(() => expect(onGone).toHaveBeenCalledTimes(1));
  });

  test('o erro do desfazer aparece dentro do diálogo e Cancelar fecha', async () => {
    api.getUnsellPreview.mockResolvedValue(preview());
    const handlers = { onConfirm: vi.fn(), onCancel: vi.fn(), onGone: vi.fn() };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderUi(<UnsellDialog item={makeItem({ id: 7, status: 'VENDIDO' })} busy={false} error="Algo falhou" {...handlers} />, { client });
    expect(await screen.findByText('Algo falhou')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handlers.onCancel).toHaveBeenCalled();
  });
});
