// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import BulkSaleStateDialog from '@/components/BulkSaleStateDialog';
import { STORES, makeItem } from '@/lib/testFixtures';
import { renderUi } from '@/test/renderUi';
import type { InventoryPosition as Position, MinPrice } from '@/types/api';
import InventoryPosition from './InventoryPosition';
import { GroupMinPrice } from './MinPriceSummary';
import SelectionBar from './SelectionBar';

// QA da 12.5b: bordas do BulkSaleStateDialog, GroupMinPrice, faixa de posição e SelectionBar.
const bulkApi = vi.hoisted(() => ({ off: vi.fn(), on: vi.fn() }));
vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  bulkMarkOffSale: bulkApi.off,
  bulkMarkForSale: bulkApi.on,
}));

afterEach(cleanup);
beforeEach(() => {
  bulkApi.off.mockReset().mockResolvedValue({});
  bulkApi.on.mockReset().mockResolvedValue({});
});

describe('BulkSaleStateDialog: foco, erro e sucesso', () => {
  test('por grupo: o foco vai para o campo de quantidade; Esc fecha e chama onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderUi(<BulkSaleStateDialog direction="OFF_SALE" name="AK" target={{ groupKey: 'k', available: 3 }} onClose={onClose} onDone={vi.fn()} />, { client: new QueryClient() });
    const field = screen.getByRole('textbox', { name: /Quantity/ });
    await waitFor(() => expect(field).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  test('por seleção: o foco fica dentro do diálogo e o nome do item não aparece', () => {
    renderUi(<BulkSaleStateDialog direction="OFF_SALE" target={{ itemIds: [1, 2, 3] }} onClose={vi.fn()} onDone={vi.fn()} />, { client: new QueryClient() });
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(within(dialog).getByText('3 units selected.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
  });

  test('uma unidade usa o singular; voltar à venda por seleção envia bulkMarkForSale com os ids', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    renderUi(<BulkSaleStateDialog direction="FOR_SALE" target={{ itemIds: [7] }} onClose={vi.fn()} onDone={onDone} />, { client: new QueryClient() });
    expect(screen.getByText('1 unit selected.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to sale' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(bulkApi.on).toHaveBeenCalledWith({ itemIds: [7] });
    expect(bulkApi.off).not.toHaveBeenCalled();
  });

  test('erro da API: mostra a mensagem, não chama onDone, e um segundo envio com sucesso conclui', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    bulkApi.off.mockRejectedValueOnce(new Error('boom'));
    renderUi(<BulkSaleStateDialog direction="OFF_SALE" target={{ itemIds: [1] }} onClose={vi.fn()} onDone={onDone} />, { client: new QueryClient() });
    await user.click(screen.getByRole('button', { name: 'Move to holding' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Move to holding' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(bulkApi.off).toHaveBeenCalledTimes(2);
  });

  test('por grupo: quantidade 0, negativa, decimal e vazia são recusadas sem chamar a API', async () => {
    const user = userEvent.setup();
    renderUi(<BulkSaleStateDialog direction="OFF_SALE" name="AK" target={{ groupKey: 'k', available: 3 }} onClose={vi.fn()} onDone={vi.fn()} />, { client: new QueryClient() });
    const field = screen.getByRole('textbox', { name: /Quantity/ });
    for (const text of ['0', '-1', '1.5', '4']) {
      await user.clear(field);
      await user.type(field, text);
      await user.click(screen.getByRole('button', { name: 'Move to holding' }));
      expect(await screen.findByText('Enter a whole number from 1 to 3.')).toBeInTheDocument();
    }
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Move to holding' }));
    expect(await screen.findByText('Enter a whole number from 1 to 3.')).toBeInTheDocument();
    expect(bulkApi.off).not.toHaveBeenCalled();
  });
});

describe('GroupMinPrice: casos de borda', () => {
  const price = (cents: number | null, storeId = 1, approx: number | null = null): MinPrice[] => [
    { storeId, storeName: storeId === 1 ? 'CSFloat' : 'Steam', currency: 'USD', minPriceCents: cents, approx: approx === null ? null : { currency: 'BRL', cents: approx }, warning: null, warningCode: null },
  ];

  test('lojas diferentes entre as unidades: não monta faixa (mostra a da primeira unidade)', () => {
    renderUi(<GroupMinPrice units={[makeItem({ id: 1, minPrices: price(4140, 1) }), makeItem({ id: 2, minPrices: price(5000, 2) })]} stores={STORES} />);
    expect(screen.queryByText(/–/)).toBeNull();
    expect(screen.getByText('$41.40')).toBeInTheDocument();
  });

  test('só uma unidade com preço (as outras sem): não monta faixa', () => {
    renderUi(<GroupMinPrice units={[makeItem({ id: 1, minPrices: price(4140) }), makeItem({ id: 2, minPrices: price(null) })]} stores={STORES} />);
    expect(screen.queryByText(/–/)).toBeNull();
  });

  test('faixa sem "≈" quando alguma unidade não tem conversão; com ela, "≈" em faixa', () => {
    const { rerender } = renderUi(<GroupMinPrice units={[makeItem({ id: 1, minPrices: price(4140, 1, 20700) }), makeItem({ id: 2, minPrices: price(4554, 1, null) })]} stores={STORES} />);
    expect(screen.getByText('$41.40 – $45.54')).toBeInTheDocument();
    expect(screen.queryByText(/R\$/)).toBeNull();
    rerender(<GroupMinPrice units={[makeItem({ id: 1, minPrices: price(4140, 1, 20700) }), makeItem({ id: 2, minPrices: price(4554, 1, 22770) })]} stores={STORES} />);
    expect(screen.getByText(/R\$\s?207\.00 – R\$\s?227\.70/)).toBeInTheDocument();
  });

  test('três unidades: a faixa vai do menor ao maior, independente da ordem', () => {
    renderUi(
      <GroupMinPrice units={[makeItem({ id: 1, minPrices: price(500) }), makeItem({ id: 2, minPrices: price(100) }), makeItem({ id: 3, minPrices: price(300) })]} stores={STORES} />,
    );
    expect(screen.getByText('$1.00 – $5.00')).toBeInTheDocument();
  });

  test('sem unidades: não quebra', () => {
    const { container } = renderUi(<GroupMinPrice units={[]} stores={STORES} />);
    expect(container).toBeTruthy();
  });
});

describe('InventoryPosition: outros casos', () => {
  const base: Position = {
    forSale: { costUsdCents: 0, costUsesRecordedFx: false, approx: null },
    offSale: { costUsdCents: 0, costUsesRecordedFx: false, approx: null },
    tradeLocked: { units: 0, nextUnlockAt: null },
    stagnant: { units: 0, groups: 0 },
  };

  test('estoque vazio: quatro cartões zerados, sem "≈"', () => {
    renderUi(<InventoryPosition position={base} />);
    const strip = screen.getByRole('group', { name: 'Inventory position' });
    expect(within(strip).getAllByText('$0.00')).toHaveLength(2);
    expect(within(strip).queryByText(/≈/)).toBeNull();
  });

  test('trade lock com unidades mas sem data (nextUnlockAt nulo): não mostra a nota', () => {
    renderUi(<InventoryPosition position={{ ...base, tradeLocked: { units: 2, nextUnlockAt: null } }} />);
    expect(screen.queryByText(/Next unlock/)).toBeNull();
  });
});

describe('SelectionBar: limites', () => {
  test('exatamente 500 ainda deixa mover; 501 não', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const { rerender } = renderUi(<SelectionBar count={500} direction="OFF_SALE" onMove={onMove} onClear={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Move to holding' });
    expect(button).not.toHaveAttribute('aria-disabled');
    await user.click(button);
    expect(onMove).toHaveBeenCalledTimes(1);
    rerender(<SelectionBar count={501} direction="OFF_SALE" onMove={onMove} onClear={vi.fn()} />);
    const over = screen.getByRole('button', { name: 'Move to holding' });
    expect(over).toHaveAttribute('aria-disabled', 'true');
    await user.click(over);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  test('na aba do holding o botão é "Put back on sale"; contagem 0 não renderiza nada', () => {
    const { rerender, container } = renderUi(<SelectionBar count={2} direction="FOR_SALE" onMove={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Put back on sale' })).toBeInTheDocument();
    rerender(<SelectionBar count={0} direction="FOR_SALE" onMove={vi.fn()} onClear={vi.fn()} />);
    expect(container.querySelector('[role="region"]')).toBeNull();
  });
});
