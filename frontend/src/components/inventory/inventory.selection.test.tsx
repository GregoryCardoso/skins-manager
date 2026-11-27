// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import BulkSaleStateDialog from '@/components/BulkSaleStateDialog';
import InventoryGroupTable from '@/components/InventoryGroupTable';
import InventoryTable from '@/components/InventoryTable';
import { DEFAULT_FILTERS } from '@/lib/inventoryQuery';
import { STORES, makeItem } from '@/lib/testFixtures';
import { renderUi } from '@/test/renderUi';
import type { InventoryPosition as Position, ItemGroup, ItemView, MinPrice } from '@/types/api';
import InventoryPosition from './InventoryPosition';
import InventoryToolbar, { SEARCH_DEBOUNCE_MS } from './InventoryToolbar';
import { GroupMinPrice } from './MinPriceSummary';
import SelectionBar, { SelectionHint } from './SelectionBar';
import type { UnitRowHandlers } from './ItemRowActions';
import type { InventorySelection } from '@/lib/inventorySelection';

const bulkApi = vi.hoisted(() => ({ off: vi.fn(), on: vi.fn() }));
vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  bulkMarkOffSale: bulkApi.off,
  bulkMarkForSale: bulkApi.on,
}));
vi.mock('@/components/useMarketSummary', () => ({ useMarketSummary: () => ({ summary: null, refreshing: false }) }));

afterEach(cleanup);
beforeEach(() => {
  bulkApi.off.mockReset().mockResolvedValue({});
  bulkApi.on.mockReset().mockResolvedValue({});
});

const LIMITS = { fastTurnoverDays: 7, slowItemDays: 21 };
const handlers = (): UnitRowHandlers => ({
  onEdit: vi.fn(), onSell: vi.fn(), onUnsell: vi.fn(), onDelete: vi.fn(), onHistory: vi.fn(), onOffSale: vi.fn(), onForSale: vi.fn(),
  onApply: vi.fn(), onOpen: vi.fn(), onRegisterKey: vi.fn(), onDetach: vi.fn(),
});
const makeGroup = (units: ItemView[], key = 'k1'): ItemGroup => ({
  key, name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', exterior: 'FT', phase: null, catalog: null, quantity: units.length,
  totalCostUsdCents: 300, avgCostUsdCents: 150, costUsesRecordedFx: false, approxCurrency: 'BRL', approx: null, componentUnits: 0, stagnantCount: 0,
  stock: { total: units.length, forSale: units.length, tradeLocked: 0, offSale: 0, nextUnlockAt: null }, units,
}) as ItemGroup;

// Estado da seleção como a página o mantém.
function WithSelection({ render }: { render: (selection: InventorySelection, selected: ReadonlySet<number>) => React.ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  return <>{render({ selected, onChange: setSelected }, selected)}</>;
}

describe('seleção única na visão individual', () => {
  const items = [makeItem({ id: 1 }), makeItem({ id: 2 }), makeItem({ id: 3 })];
  const table = (selection: InventorySelection) => (
    <InventoryTable items={items} stores={STORES} handlers={handlers()} limits={LIMITS} density="compact" order="desc" onOrderChange={() => {}} selection={selection} />
  );

  test('caixa por unidade e "selecionar todas" com estado parcial', async () => {
    const user = userEvent.setup();
    renderUi(<WithSelection render={(selection, selected) => <><span data-testid="n">{selected.size}</span>{table(selection)}</>} />);
    await user.click(screen.getByRole('checkbox', { name: /Select AK-47 \| Linha Vermelha \(#2\)/ }));
    expect(screen.getByTestId('n')).toHaveTextContent('1');
    const all = screen.getByRole('checkbox', { name: 'Select all rows' }) as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    await user.click(all);
    expect(screen.getByTestId('n')).toHaveTextContent('3');
    await user.click(all);
    expect(screen.getByTestId('n')).toHaveTextContent('0');
  });

  test('sem a prop selection não há caixas', () => {
    renderUi(<InventoryTable items={items} stores={STORES} handlers={handlers()} limits={LIMITS} density="compact" order="desc" onOrderChange={() => {}} />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});

describe('seleção única na visão agrupada', () => {
  const baseProps = { stores: STORES, limits: LIMITS, density: 'compact' as const, order: 'desc' as const, onOrderChange: () => {}, onToggle: () => {} };

  test('a caixa do grupo marca todas as unidades da tela; marcar uma só deixa o grupo parcial', async () => {
    const user = userEvent.setup();
    const g = makeGroup([makeItem({ id: 1 }), makeItem({ id: 2 })]);
    renderUi(
      <WithSelection
        render={(selection, selected) => (
          <>
            <span data-testid="ids">{[...selected].sort().join(',')}</span>
            <InventoryGroupTable {...baseProps} expandedKeys={new Set(['k1'])} groups={[g]} handlers={handlers()} selection={selection} />
          </>
        )}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: /Select AK-47 \| Linha Vermelha \(#1\)/ }));
    expect(screen.getByTestId('ids')).toHaveTextContent('1');
    const groupBox = screen.getByRole('checkbox', { name: 'Select the units of AK-47 | Redline shown' }) as HTMLInputElement;
    expect(groupBox.indeterminate).toBe(true);
    await user.click(groupBox);
    expect(screen.getByTestId('ids')).toHaveTextContent('1,2');
    expect(groupBox.checked).toBe(true);
    await user.click(groupBox);
    expect(screen.getByTestId('ids')).toHaveTextContent('');
  });
});

describe('SelectionBar e dica', () => {
  test('sem seleção não aparece; com seleção mostra contagem, mover e limpar', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const onClear = vi.fn();
    const { rerender } = renderUi(<SelectionBar count={0} direction="OFF_SALE" onMove={onMove} onClear={onClear} />);
    expect(screen.queryByRole('region')).toBeNull();
    rerender(<SelectionBar count={3} direction="OFF_SALE" onMove={onMove} onClear={onClear} />);
    const bar = screen.getByRole('region', { name: 'Selected units' });
    expect(within(bar).getByText('3 selected')).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Move to holding' }));
    expect(onMove).toHaveBeenCalled();
    await user.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(onClear).toHaveBeenCalled();
    rerender(<SelectionBar count={1} direction="FOR_SALE" onMove={onMove} onClear={onClear} />);
    expect(screen.getByRole('button', { name: 'Put back on sale' })).toBeInTheDocument();
  });

  test('acima de 500 o botão fica desabilitado (focável) com o motivo visível', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    renderUi(<SelectionBar count={501} direction="OFF_SALE" onMove={onMove} onClear={() => {}} />);
    const button = screen.getByRole('button', { name: 'Move to holding' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.click(button);
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByText('Up to 500 units at a time.')).toBeInTheDocument();
  });

  test('a dica fixa', () => {
    renderUi(<SelectionHint />);
    expect(screen.getByText('Tick several units to move them together.')).toBeInTheDocument();
  });
});

describe('BulkSaleStateDialog (Dialog + NumberField)', () => {
  test('por seleção: envia os ids na chamada atômica e avisa ao terminar', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    renderUi(<BulkSaleStateDialog direction="OFF_SALE" target={{ itemIds: [4, 5] }} onClose={() => {}} onDone={onDone} />, { client: new QueryClient() });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('2 units selected.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move to holding' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(bulkApi.off).toHaveBeenCalledWith({ itemIds: [4, 5] });
  });

  test('por grupo: quantidade inválida mostra o erro no campo; válida envia groupKey e quantity; voltar à venda avisa do giro', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    renderUi(<BulkSaleStateDialog direction="FOR_SALE" name="AK" target={{ groupKey: 'k1', available: 3 }} onClose={() => {}} onDone={onDone} />, { client: new QueryClient() });
    expect(screen.getByText('When put back on sale, the day count starts again.')).toBeInTheDocument();
    const field = screen.getByRole('textbox', { name: /Quantity \(1 to 3\)/ });
    await user.clear(field);
    await user.type(field, '9');
    await user.click(screen.getByRole('button', { name: 'Back to sale' }));
    expect(await screen.findByText('Enter a whole number from 1 to 3.')).toBeInTheDocument();
    expect(bulkApi.on).not.toHaveBeenCalled();
    await user.clear(field);
    await user.type(field, '2');
    await user.click(screen.getByRole('button', { name: 'Back to sale' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(bulkApi.on).toHaveBeenCalledWith({ groupKey: 'k1', quantity: 2 });
  });

  test('erro da API aparece no diálogo e ele continua aberto', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    bulkApi.off.mockRejectedValue(new Error('boom'));
    renderUi(<BulkSaleStateDialog direction="OFF_SALE" target={{ itemIds: [1] }} onClose={() => {}} onDone={onDone} />, { client: new QueryClient() });
    await user.click(screen.getByRole('button', { name: 'Move to holding' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('InventoryPosition', () => {
  const position: Position = {
    forSale: { costUsdCents: 12345, costUsesRecordedFx: false, approx: { currency: 'BRL', cents: 61725 } },
    offSale: { costUsdCents: 500, costUsesRecordedFx: true, approx: null },
    tradeLocked: { units: 2, nextUnlockAt: '2026-12-01T00:00:00.000Z' },
    stagnant: { units: 3, groups: 2 },
  };

  test('quatro números com "≈" discreto, próxima liberação e grupos encalhados', () => {
    renderUi(<InventoryPosition position={position} />);
    const strip = screen.getByRole('group', { name: 'Inventory position' });
    expect(within(strip).getByText('For sale (cost)')).toBeInTheDocument();
    expect(within(strip).getByText('$123.45')).toBeInTheDocument();
    expect(within(strip).getByText(/R\$\s?617\.25/)).toBeInTheDocument();
    expect(within(strip).getByText('In holding (cost)')).toBeInTheDocument();
    expect(within(strip).getByText('In trade lock (units)')).toBeInTheDocument();
    expect(within(strip).getByText(/Next unlock:/)).toBeInTheDocument();
    expect(within(strip).getByText('Different items: 2')).toBeInTheDocument();
  });

  test('sem trade lock nem encalhados, sem notas', () => {
    renderUi(<InventoryPosition position={{ ...position, tradeLocked: { units: 0, nextUnlockAt: null }, stagnant: { units: 0, groups: 0 } }} />);
    expect(screen.queryByText(/Next unlock/)).toBeNull();
    expect(screen.queryByText(/Different items/)).toBeNull();
  });
});

describe('GroupMinPrice (Q-12.5-3)', () => {
  const price = (cents: number, approx: number | null = null): MinPrice[] => [
    { storeId: 1, storeName: 'CSFloat', currency: 'USD', minPriceCents: cents, approx: approx === null ? null : { currency: 'BRL', cents: approx }, warning: null, warningCode: null },
  ];

  test('uma unidade: o valor dela; várias com valores diferentes: faixa "x – y" com ajuda', () => {
    const { rerender } = renderUi(<GroupMinPrice units={[makeItem({ id: 1, minPrices: price(4140) })]} stores={STORES} />);
    expect(screen.getByText('$41.40')).toBeInTheDocument();
    rerender(<GroupMinPrice units={[makeItem({ id: 1, minPrices: price(4554, 22770) }), makeItem({ id: 2, minPrices: price(4140, 20700) })]} stores={STORES} />);
    expect(screen.getByText('$41.40 – $45.54')).toBeInTheDocument();
    expect(screen.getByText(/R\$\s?207\.00 – R\$\s?227\.70/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help: Break-even price' })).toBeInTheDocument();
  });

  test('valores iguais: um valor só (sem faixa)', () => {
    renderUi(<GroupMinPrice units={[makeItem({ id: 1, minPrices: price(4140) }), makeItem({ id: 2, minPrices: price(4140) })]} stores={STORES} />);
    expect(screen.getByText('$41.40')).toBeInTheDocument();
    expect(screen.queryByText(/–/)).toBeNull();
  });
});

describe('busca na barra de filtros', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  const props = {
    slowItemDays: 21, loading: false, view: 'GROUPED' as const, groupedAvailable: true, onViewChange: vi.fn(), density: 'COMPACT' as const,
    onDensityChange: vi.fn(), onClear: vi.fn(), onRefresh: vi.fn(),
  };

  test('digitar espera a pausa e então grava na URL (via onChange); Enter grava na hora', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();
    renderUi(<InventoryToolbar {...props} onChange={onChange} filters={DEFAULT_FILTERS} />);
    const field = screen.getByRole('searchbox', { name: 'Search by name' });
    await user.type(field, 'redl');
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 10);
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, search: 'redl' });
    onChange.mockClear();
    await user.type(field, 'ine{Enter}');
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, search: 'redline' });
  });

  test('mostra a busca que veio da URL e a atualiza quando ela muda por fora', () => {
    const { rerender } = renderUi(<InventoryToolbar {...props} onChange={vi.fn()} filters={{ ...DEFAULT_FILTERS, search: 'awp' }} />);
    expect(screen.getByRole('searchbox', { name: 'Search by name' })).toHaveValue('awp');
    rerender(<InventoryToolbar {...props} onChange={vi.fn()} filters={DEFAULT_FILTERS} />);
    expect(screen.getByRole('searchbox', { name: 'Search by name' })).toHaveValue('');
  });
});
