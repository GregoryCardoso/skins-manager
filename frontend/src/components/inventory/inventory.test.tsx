// @vitest-environment jsdom
import '@/test/setupDom';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import InventoryGroupTable from '@/components/InventoryGroupTable';
import InventoryTable from '@/components/InventoryTable';
import { unitColumns, groupColumns } from '@/lib/inventoryColumns';
import { DEFAULT_FILTERS } from '@/lib/inventoryQuery';
import { STORES, makeItem } from '@/lib/testFixtures';
import { renderUi } from '@/test/renderUi';
import type { ItemGroup, ItemView, MinPrice } from '@/types/api';
import ItemRowActions, { type UnitRowHandlers } from './ItemRowActions';
import InventoryToolbar from './InventoryToolbar';
import MinPriceSummary from './MinPriceSummary';

vi.mock('@/components/useMarketSummary', () => ({ useMarketSummary: () => ({ summary: null, refreshing: false }) }));

afterEach(cleanup);

const LIMITS = { fastTurnoverDays: 7, slowItemDays: 21 };
const LOCKED = { isLocked: true, remainingMs: 3 * 86400000, formatted: '3d', tradeUnlockAt: '2026-12-01T00:00:00.000Z' };

function makeHandlers(): UnitRowHandlers {
  return {
    onEdit: vi.fn(), onSell: vi.fn(), onUnsell: vi.fn(), onDelete: vi.fn(), onHistory: vi.fn(), onOffSale: vi.fn(), onForSale: vi.fn(),
    onApply: vi.fn(), onOpen: vi.fn(), onRegisterKey: vi.fn(), onDetach: vi.fn(),
  };
}

describe('ItemRowActions', () => {
  test('Vender é a ação principal e chama onSell; o menu abre com Enter e Esc devolve o foco', async () => {
    const user = userEvent.setup();
    const handlers = makeHandlers();
    const item = makeItem();
    renderUi(<ItemRowActions item={item} handlers={handlers} />);

    await user.click(screen.getByRole('button', { name: 'Sell' }));
    expect(handlers.onSell).toHaveBeenCalledWith(item);

    const trigger = screen.getByRole('button', { name: 'More actions for AK-47 | Linha Vermelha' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  test('escolher um item do menu chama o manipulador', async () => {
    const user = userEvent.setup();
    const handlers = makeHandlers();
    const item = makeItem();
    renderUi(<ItemRowActions item={item} handlers={handlers} />);
    await user.click(screen.getByRole('button', { name: /More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move to holding' }));
    expect(handlers.onOffSale).toHaveBeenCalledWith(item);
  });

  test('em trade lock a principal fica aria-disabled (focável) e não chama onSell', async () => {
    const user = userEvent.setup();
    const handlers = makeHandlers();
    renderUi(<ItemRowActions item={makeItem({ tradeLock: LOCKED })} handlers={handlers} />);
    const sell = screen.getByRole('button', { name: 'Sell' });
    expect(sell).toHaveAttribute('aria-disabled', 'true');
    expect(sell).not.toBeDisabled();
    await user.click(sell);
    expect(handlers.onSell).not.toHaveBeenCalled();
  });

  test('no holding a principal é Put back on sale e o Vender do menu mostra o motivo se estiver em trade lock', async () => {
    const user = userEvent.setup();
    const handlers = makeHandlers();
    const item = makeItem({ saleState: 'OFF_SALE', tradeLock: LOCKED });
    renderUi(<ItemRowActions item={item} handlers={handlers} />);
    await user.click(screen.getByRole('button', { name: 'Put back on sale' }));
    expect(handlers.onForSale).toHaveBeenCalledWith(item);
    await user.click(screen.getByRole('button', { name: /More actions/ }));
    const sell = await screen.findByRole('menuitem', { name: /Sell/ });
    expect(sell).toHaveAttribute('aria-disabled', 'true');
    expect(within(sell).getByText(/Trade locked until/)).toBeInTheDocument();
  });

  test('Abrir sem chave fica desabilitado com o motivo visível; Inspecionar é um link seguro', async () => {
    const user = userEvent.setup();
    const handlers = makeHandlers();
    const item = makeItem({
      inspectLink: 'https://example.com/inspect',
      openable: { kind: 'CASE', compatibleKeys: 0, otherKeysInStock: 0, otherKeyNames: [], requiredKeyName: 'Chroma Key' },
    });
    renderUi(<ItemRowActions item={item} handlers={handlers} />);
    await user.click(screen.getByRole('button', { name: /More actions/ }));
    const open = await screen.findByRole('menuitem', { name: /Open case/ });
    expect(open).toHaveAttribute('aria-disabled', 'true');
    expect(within(open).getByText(/Register this case's key \(Chroma Key\) first/)).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Register key/ })).toBeInTheDocument();
    const inspect = screen.getByRole('menuitem', { name: /Inspect/ });
    expect(inspect.tagName).toBe('A');
    expect(inspect).toHaveAttribute('href', 'https://example.com/inspect');
    expect(inspect).toHaveAttribute('rel', 'noopener noreferrer');
    expect(inspect).toHaveAttribute('target', '_blank');
  });

  test('link de inspeção inválido não entra no menu', async () => {
    const user = userEvent.setup();
    renderUi(<ItemRowActions item={makeItem({ inspectLink: 'javascript:alert(1)' })} handlers={makeHandlers()} />);
    await user.click(screen.getByRole('button', { name: /More actions/ }));
    await screen.findByRole('menuitem', { name: 'Edit' });
    expect(screen.queryByRole('menuitem', { name: /Inspect/ })).toBeNull();
  });
});

describe('MinPriceSummary', () => {
  const base: MinPrice = { storeId: 1, storeName: 'CSFloat', currency: 'USD', minPriceCents: null, approx: null, warning: null, warningCode: null };

  test('FEES_NOT_CONFIGURED leva a Lojas e FX_NOT_CONFIGURED, às configurações; PRICE_OVERFLOW fica sem link', () => {
    const { rerender } = renderUi(<MinPriceSummary minPrices={[{ ...base, warningCode: 'FEES_NOT_CONFIGURED' }]} stores={STORES} />);
    expect(screen.getByRole('link', { name: 'Go to Stores' })).toHaveAttribute('href', '/stores');
    rerender(<MinPriceSummary minPrices={[{ ...base, warningCode: 'FX_NOT_CONFIGURED' }]} stores={STORES} />);
    expect(screen.getByRole('link', { name: 'Go to Settings' })).toHaveAttribute('href', '/settings#fx');
    rerender(<MinPriceSummary minPrices={[{ ...base, warningCode: 'PRICE_OVERFLOW' }]} stores={STORES} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/too high/)).toBeInTheDocument();
  });

  test('mostra o valor da loja principal e, com showOthers, as demais lojas; a ajuda abre pelo teclado', async () => {
    const user = userEvent.setup();
    const prices: MinPrice[] = [
      { ...base, storeId: 2, storeName: 'Steam', currency: 'BRL', minPriceCents: 5000, approx: { currency: 'USD', cents: 950 } },
      { ...base, storeId: 1, storeName: 'CSFloat', minPriceCents: 1234 },
    ];
    renderUi(<MinPriceSummary minPrices={prices} stores={STORES} showOthers />);
    expect(screen.getByText('$12.34')).toBeInTheDocument();
    const others = screen.getByRole('list', { name: 'Other stores' });
    expect(within(others).getByText('Steam')).toBeInTheDocument();
    const help = screen.getByRole('button', { name: 'Help: Break-even price' });
    help.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/lowest price at which the net amount covers the cost/)).toBeInTheDocument();
  });

  test('sem lojas ativas e sem preços', () => {
    const { rerender } = renderUi(<MinPriceSummary minPrices={null} stores={STORES} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    rerender(<MinPriceSummary minPrices={[]} stores={STORES} />);
    expect(screen.getByText('No active stores')).toBeInTheDocument();
  });
});

describe('InventoryToolbar', () => {
  const props = {
    slowItemDays: 21, loading: false, view: 'GROUPED' as const, groupedAvailable: true, onViewChange: vi.fn(), density: 'COMPACT' as const,
    onDensityChange: vi.fn(), onChange: vi.fn(), onClear: vi.fn(), onRefresh: vi.fn(),
  };

  test('o chip "Só encalhados" fica desabilitado no holding e liga/desliga no estoque à venda', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = renderUi(<InventoryToolbar {...props} onChange={onChange} filters={DEFAULT_FILTERS} />);
    const chip = screen.getByRole('button', { name: /Stuck only/ });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await user.click(chip);
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, stagnant: true });
    rerender(<InventoryToolbar {...props} onChange={onChange} filters={{ ...DEFAULT_FILTERS, saleState: 'OFF_SALE' }} />);
    expect(screen.getByRole('button', { name: /Stuck only/ })).toBeDisabled();
  });

  test('a densidade troca pelo controle segmentado; com Vendido a visão agrupada fica desabilitada e mostra Individual', async () => {
    const user = userEvent.setup();
    const onDensityChange = vi.fn();
    renderUi(
      <InventoryToolbar {...props} onDensityChange={onDensityChange} filters={{ ...DEFAULT_FILTERS, status: 'VENDIDO' }} groupedAvailable={false} />,
    );
    await user.click(screen.getByRole('radio', { name: 'Comfortable' }));
    expect(onDensityChange).toHaveBeenCalledWith('COMFORTABLE');
    expect(screen.getByRole('radio', { name: 'Individual' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Grouped' })).toBeDisabled();
    expect(screen.getByText('The grouped view is only for items in stock.')).toBeInTheDocument();
  });
});

describe('InventoryTable (visão individual)', () => {
  const noop = () => {};

  test('a ordem fica no cabeçalho Giro (aria-sort) e só pede à API; as linhas não são reordenadas', async () => {
    const user = userEvent.setup();
    const onOrderChange = vi.fn();
    const items = [makeItem({ id: 1, name: 'Zeta' }), makeItem({ id: 2, name: 'Alpha' })];
    renderUi(
      <InventoryTable items={items} stores={STORES} handlers={makeHandlers()} limits={LIMITS} density="compact" order="desc" onOrderChange={onOrderChange} />,
    );
    const header = screen.getByRole('columnheader', { name: /Turnover/ });
    expect(header).toHaveAttribute('aria-sort', 'descending');
    await user.click(within(header).getByRole('button'));
    expect(onOrderChange).toHaveBeenCalledWith('asc');
    const names = screen.getAllByRole('row').map((row) => row.textContent ?? '');
    expect(names.findIndex((text) => text.includes('Zeta'))).toBeLessThan(names.findIndex((text) => text.includes('Alpha')));
  });

  test('mostra a régua com o nome da faixa, a legenda e o estado de trade lock sem faixa de giro', () => {
    const items = [
      makeItem({ id: 1, aging: { daysInInventory: 30, daysForSale: 30, agingBucket: 'AGARRADO' } }),
      makeItem({ id: 2, tradeLock: LOCKED, aging: { daysInInventory: 1, daysForSale: null, agingBucket: 'EM_TRADE_LOCK' } }),
    ];
    const { container } = renderUi(
      <InventoryTable items={items} stores={STORES} handlers={makeHandlers()} limits={LIMITS} density="compact" order="desc" onOrderChange={noop} />,
    );
    expect(container.querySelector('[data-bucket="AGARRADO"]')).not.toBeNull();
    expect(container.querySelector('[data-bucket="EM_TRADE_LOCK"]')).not.toBeNull();
    expect(screen.getByText(/Trade lock · releases in 3d 0h 0min/)).toBeInTheDocument();
    expect(screen.getByText(/Stuck above 21 days/)).toBeInTheDocument();
    const rows = container.querySelectorAll('tr[data-row-id]');
    expect(rows[0]).toHaveAttribute('data-tone', 'stuck');
    expect(rows[1]).toHaveAttribute('data-tone', 'lock');
  });

  test('a densidade confortável vai para a tabela e o item apontado por ?item= ganha aria-current', () => {
    const { container } = renderUi(
      <InventoryTable items={[makeItem({ id: 7 })]} stores={STORES} handlers={makeHandlers()} limits={LIMITS} density="comfortable" order="desc" onOrderChange={noop} highlightedItemId={7} />,
    );
    expect(container.querySelector('table')).toHaveAttribute('data-density', 'comfortable');
    expect(container.querySelector('tr[data-row-id="7"]')).toHaveAttribute('aria-current', 'true');
  });

  test('vazio e carregando', () => {
    const { container, rerender } = renderUi(
      <InventoryTable items={[]} stores={STORES} handlers={makeHandlers()} limits={LIMITS} density="compact" order="desc" onOrderChange={noop} empty={<p>Nothing here</p>} />,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    rerender(<InventoryTable items={[]} stores={STORES} handlers={makeHandlers()} limits={LIMITS} density="compact" order="desc" onOrderChange={noop} loading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

function makeGroup(units: ItemView[]): ItemGroup {
  return {
    key: 'k1', name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', exterior: 'FT', phase: null, catalog: null,
    quantity: units.length, totalCostUsdCents: 300, avgCostUsdCents: 150, costUsesRecordedFx: true, approxCurrency: 'BRL',
    approx: { totalCostCents: 1500, avgCostCents: 750 }, componentUnits: 0, stagnantCount: 1,
    stock: { total: units.length, forSale: units.length, tradeLocked: 0, offSale: 0, nextUnlockAt: null },
    units,
  };
}

describe('InventoryGroupTable (visão agrupada)', () => {
  const baseProps = {
    stores: STORES, limits: LIMITS, density: 'compact' as const, order: 'desc' as const, onOrderChange: () => {}, onToggle: () => {}, expandedKeys: new Set<string>(),
  };

  test('uma linha por grupo com quantidade, selo de encalhados e ações; expandir mostra as unidades com as mesmas ações', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const handlers = makeHandlers();
    const units = [makeItem({ id: 1, floatValue: 0.12 }), makeItem({ id: 2, floatValue: 0.34 })];
    const { rerender } = renderUi(<InventoryGroupTable {...baseProps} groups={[makeGroup(units)]} handlers={handlers} onToggle={onToggle} />);
    expect(screen.getByText('2 for sale · 0 in holding')).toBeInTheDocument();
    expect(screen.getByText('1 stuck')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show units of AK-47 | Redline' }));
    expect(onToggle).toHaveBeenCalledWith('k1');

    rerender(<InventoryGroupTable {...baseProps} expandedKeys={new Set(['k1'])} groups={[makeGroup(units)]} handlers={handlers} onToggle={onToggle} />);
    expect(screen.getByText(/float 0\.12/)).toBeInTheDocument();
    expect(screen.getByText(/float 0\.34/)).toBeInTheDocument();
    // grupo + 2 unidades, cada um com "Vender" e "Mais ações"
    expect(screen.getAllByRole('button', { name: 'Sell' })).toHaveLength(3);
  });

  test('Vender no grupo abre a venda da primeira unidade que pode ser vendida', async () => {
    const user = userEvent.setup();
    const handlers = makeHandlers();
    const units = [makeItem({ id: 1, tradeLock: LOCKED }), makeItem({ id: 2 })];
    renderUi(<InventoryGroupTable {...baseProps} groups={[makeGroup(units)]} handlers={handlers} />);
    await user.click(screen.getAllByRole('button', { name: 'Sell' })[0]);
    // A venda pela linha do grupo recebe também as unidades, para o seletor de unidade (12.6b).
    expect(handlers.onSell).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), expect.arrayContaining([expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 })]));
  });

  test('aba Holding: a principal do grupo é Put back on sale (lote)', () => {
    const units = [makeItem({ id: 1, saleState: 'OFF_SALE', aging: { daysInInventory: 4, daysForSale: null, agingBucket: 'FORA_DE_VENDA' } })];
    const group = { ...makeGroup(units), stagnantCount: 0, stock: { total: 1, forSale: 0, tradeLocked: 0, offSale: 1, nextUnlockAt: null } };
    renderUi(<InventoryGroupTable {...baseProps} saleState="OFF_SALE" groups={[group]} handlers={makeHandlers()} />);
    expect(screen.getByRole('button', { name: 'Put back on sale' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sell' })).toBeNull();
  });
});

describe('colunas', () => {
  const t = ((key: string) => key) as Parameters<typeof unitColumns>[0]['t'];

  test('ids estáveis e prioridades: p1 sempre visíveis, custo e loja p2, valor de mercado e dias p3', () => {
    const columns = unitColumns({ t, stores: STORES, limits: LIMITS, handlers: makeHandlers(), forSalePendingId: null, showMarket: true });
    expect(columns.map((c) => [c.id, c.priority])).toEqual([
      ['image', 1], ['item', 1], ['store', 2], ['cost', 2], ['marketValue', 3], ['unrealized', 3], ['minPrice', 1], ['turnover', 1], ['days', 3], ['actions', 1],
    ]);
    expect(columns.find((c) => c.id === 'turnover')?.sortable).toBe(true);
    expect(columns.find((c) => c.id === 'actions')?.hideHeader).toBe(true);
  });

  test('sem valor de mercado (Vendido) saem as duas colunas', () => {
    const columns = unitColumns({ t, stores: STORES, limits: LIMITS, handlers: makeHandlers(), forSalePendingId: null, showMarket: false });
    expect(columns.map((c) => c.id)).not.toContain('marketValue');
    expect(columns.map((c) => c.id)).not.toContain('unrealized');
  });

  test('visão agrupada', () => {
    const columns = groupColumns({
      t, locale: 'en', stores: STORES, limits: LIMITS, groupHandlers: { onSellGroup: vi.fn(), onToggle: vi.fn(), onBulk: vi.fn() },
      saleState: 'FOR_SALE', expandedKeys: new Set(), showMarket: true,
    });
    expect(columns.map((c) => [c.id, c.priority])).toEqual([
      ['image', 1], ['item', 1], ['quantity', 1], ['minPrice', 1], ['turnover', 1], ['avgCost', 2], ['totalCost', 3], ['marketValue', 3], ['unrealized', 3], ['actions', 1],
    ]);
  });
});

// Nenhum `title=` nos componentes do inventário (D370, 12.5a): a explicação vai num HelpTip, que chega ao teclado e ao toque.
describe('varredura de title=', () => {
  const root = path.join(__dirname, '..');
  const files = [
    ...fs.readdirSync(__dirname).filter((n) => n.endsWith('.tsx') && !n.endsWith('.test.tsx')).map((n) => path.join(__dirname, n)),
    path.join(root, 'InventoryTable.tsx'),
    path.join(root, 'InventoryGroupTable.tsx'),
    path.join(root, 'MarketValueCell.tsx'),
    path.join(root, '..', 'lib', 'inventoryColumns.tsx'),
  ];

  test.each(files.map((f) => [path.relative(path.join(root, '..'), f), f]))('%s não usa title=', (_name, file) => {
    const code = fs.readFileSync(file, 'utf8');
    // atributo `title` em elementos HTML (as props `title` de componentes nossos, como PageHeader e EmptyState, são outra coisa)
    expect(code).not.toMatch(/<(span|div|a|button|li|td|th|strong|small|p|img)\b[^>]*\stitle=/);
  });
});
