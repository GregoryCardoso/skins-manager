// @vitest-environment jsdom
import '@/test/setupDom';
import { useState } from 'react';
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
  approxCents: null, approxCurrency: 'USD', estimated: false, currencyMismatch: false, returnsTo: 'FOR_SALE', ...extra,
});
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderDialog(props: Partial<React.ComponentProps<typeof UnsellDialog>> = {}) {
  const handlers = { onConfirm: vi.fn(), onCancel: vi.fn(), onGone: vi.fn() };
  renderUi(<UnsellDialog item={makeItem({ id: 7, status: 'VENDIDO' })} busy={false} error={null} {...handlers} {...props} />, { client: newClient() });
  return handlers;
}

beforeEach(() => {
  api.getUnsellPreview.mockReset();
});
afterEach(cleanup);

describe('UnsellDialog: casos extras (12.6b)', () => {
  test.each([['ITEM_NOT_FOUND', 404], ['ITEM_CONSUMED', 409]])('%s da prévia chama onGone e não mostra o aviso de falha', async (code, status) => {
    api.getUnsellPreview.mockImplementation(() => Promise.reject(new ApiRequestError(code, 'x', status)));
    const { onGone } = renderDialog();
    await waitFor(() => expect(onGone).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Couldn't work out the effect/)).not.toBeInTheDocument();
  });

  test('falha comum (500) não chama onGone e mostra o aviso', async () => {
    api.getUnsellPreview.mockImplementation(() => Promise.reject(new ApiRequestError('INTERNAL_ERROR', 'falhou', 500)));
    const { onGone } = renderDialog();
    expect(await screen.findByText(/Couldn't work out the effect/)).toBeInTheDocument();
    expect(onGone).not.toHaveBeenCalled();
  });

  test('loja em JPY: valor sem casas decimais', async () => {
    api.getUnsellPreview.mockResolvedValue(preview({
      storeCurrency: 'JPY', balanceEffectCents: -102900, availableBeforeCents: 500000, availableAfterCents: 397100,
    }));
    renderDialog();
    expect(await screen.findByText(/¥1,029 leaves the available balance/)).toBeInTheDocument();
    expect(screen.getByText(/¥5,000 → ¥3,971/)).toBeInTheDocument();
  });

  test('sem "≈" quando o backend não manda o valor aproximado', async () => {
    api.getUnsellPreview.mockResolvedValue(preview());
    renderDialog();
    await screen.findByText(/leaves the available balance/);
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });

  test('o saldo negativo e o item do holding aparecem juntos', async () => {
    api.getUnsellPreview.mockResolvedValue(preview({ availableAfterCents: -100, returnsTo: 'OFF_SALE' }));
    renderDialog();
    expect(await screen.findByText('The balance will be negative.')).toBeInTheDocument();
    expect(screen.getByText('The item goes back to stock, in holding.')).toBeInTheDocument();
  });

  test('venda retida com o disponível já negativo: o desfazer não mexe no disponível, então não há aviso de saldo negativo', async () => {
    api.getUnsellPreview.mockResolvedValue(
      preview({ wasReleased: false, availableBeforeCents: -500, availableAfterCents: -500, pendingBeforeCents: 1900, pendingAfterCents: 700, balanceEffectCents: -1200 }),
    );
    renderDialog();
    await screen.findByText(/pending/);
    expect(screen.queryByText('The balance will be negative.')).not.toBeInTheDocument();
  });

  test('ocupado (busy): o desfazer não pode ser acionado de novo', async () => {
    api.getUnsellPreview.mockResolvedValue(preview());
    const { onConfirm } = renderDialog({ busy: true });
    await screen.findByText(/leaves the available balance/);
    const buttons = screen.getAllByRole('button', { name: 'Undo sale' });
    for (const button of buttons) await userEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('a prévia é buscada de novo a cada abertura (sem cache)', async () => {
    api.getUnsellPreview.mockResolvedValueOnce(preview({ balanceEffectCents: -1200 }));
    api.getUnsellPreview.mockResolvedValueOnce(preview({ balanceEffectCents: -900, availableAfterCents: 83310 }));
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(true)}>Abrir</button>
          {open && <UnsellDialog item={makeItem({ id: 7, status: 'VENDIDO' })} busy={false} error={null} onConfirm={vi.fn()} onCancel={() => setOpen(false)} onGone={vi.fn()} />}
        </>
      );
    }
    renderUi(<Harness />, { client: newClient() });
    expect(await screen.findByText(/\$12\.00 leaves/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(await screen.findByText(/\$9\.00 leaves/)).toBeInTheDocument();
    expect(api.getUnsellPreview).toHaveBeenCalledTimes(2);
  });

  test('foco: Cancelar devolve o foco ao botão da linha (D118)', async () => {
    api.getUnsellPreview.mockResolvedValue(preview());
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Desfazer linha</button>
          {open && <UnsellDialog item={makeItem({ id: 7, status: 'VENDIDO' })} busy={false} error={null} onConfirm={vi.fn()} onCancel={() => setOpen(false)} onGone={vi.fn()} />}
        </>
      );
    }
    renderUi(<Harness />, { client: newClient() });
    const trigger = screen.getByRole('button', { name: 'Desfazer linha' });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
