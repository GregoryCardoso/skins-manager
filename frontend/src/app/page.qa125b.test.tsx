// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { STORES, makeItem } from '@/lib/testFixtures';
import { renderUi } from '@/test/renderUi';
import type { ItemGroup, ItemView } from '@/types/api';
import InventoryPage from './page';

// QA da 12.5b: a página do inventário com a API simulada. URL simulada com um roteador de memória.
const nav = vi.hoisted(() => {
  const state = { query: '', listeners: new Set<() => void>() };
  const set = (next: string) => {
    state.query = next;
    state.listeners.forEach((l) => l());
  };
  return { state, set };
});
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({
    replace: (url: string) => nav.set(url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''),
    push: vi.fn(),
  }),
  useSearchParams: () => {
    const q = useSyncExternalStore(
      (cb) => {
        nav.state.listeners.add(cb);
        return () => nav.state.listeners.delete(cb);
      },
      () => nav.state.query,
      () => nav.state.query,
    );
    return new URLSearchParams(q);
  },
}));

const prefs = vi.hoisted(() => ({ view: 'INDIVIDUAL' as 'INDIVIDUAL' | 'GROUPED', setView: vi.fn() }));
vi.mock('@/components/PreferencesProvider', () => ({
  usePreferences: () => ({
    inventoryView: prefs.view, setInventoryView: prefs.setView, inventoryDensity: 'COMPACT', setInventoryDensity: vi.fn(),
    displayCurrency: 'USD', rateFor: () => null, usdBrlRate: null, fxRates: {},
  }),
}));

const api = vi.hoisted(() => ({ listItems: vi.fn(), listItemGroups: vi.fn(), listStores: vi.fn(), off: vi.fn(), on: vi.fn() }));
vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  listItems: api.listItems,
  listItemGroups: api.listItemGroups,
  listStores: api.listStores,
  bulkMarkOffSale: api.off,
  bulkMarkForSale: api.on,
}));
vi.mock('@/components/useMarketSummary', () => ({ useMarketSummary: () => ({ summary: null, refreshing: false }) }));
vi.mock('@/components/ImportButton', () => ({ default: () => null }));
vi.mock('@/components/PriceStatusIndicator', () => ({ default: () => null }));
vi.mock('@/components/ItemDialogs', () => ({
  useItemDialogs: () => ({
    openCreate: vi.fn(), openEdit: vi.fn(), openSell: vi.fn(), openUnsell: vi.fn(), openDelete: vi.fn(), openHistory: vi.fn(), openOffSale: vi.fn(),
    openApply: vi.fn(), openOpen: vi.fn(), openDetach: vi.fn(), openRegisterKey: vi.fn(), putForSale: vi.fn(), forSalePendingId: null, dialogs: null,
  }),
}));

const META = { fastTurnoverDays: 7, slowItemDays: 21, usdBrlRate: null, generatedAt: '2026-11-27T00:00:00.000Z', saleStateCounts: { forSale: 3, offSale: 1 } };
const unit = (id: number, over: Partial<ItemView> = {}) => makeItem({ id, ...over });
let items: ItemView[];

const makeGroup = (key: string, units: ItemView[]): ItemGroup => ({
  key, name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', exterior: 'FT', phase: null, catalog: null, quantity: units.length,
  totalCostUsdCents: 300, avgCostUsdCents: 150, costUsesRecordedFx: false, approxCurrency: 'BRL', approx: null, componentUnits: 0, stagnantCount: 0,
  stock: { total: units.length, forSale: units.length, tradeLocked: 0, offSale: 0, nextUnlockAt: null }, units,
}) as ItemGroup;

beforeEach(() => {
  nav.set('');
  prefs.view = 'INDIVIDUAL';
  items = [unit(1), unit(2), unit(3)];
  api.listItems.mockReset().mockImplementation(async () => ({ items, meta: { ...META, count: items.length } }));
  api.listItemGroups.mockReset().mockImplementation(async () => ({
    groups: [makeGroup('g1', [unit(1), unit(2)]), makeGroup('g2', [unit(3)])], meta: { ...META, count: 3, groupCount: 2 },
  }));
  api.listStores.mockReset().mockResolvedValue(STORES);
  api.off.mockReset().mockResolvedValue({});
  api.on.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

const mount = () => renderUi(<InventoryPage />, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }), withToast: true });
const unitBoxes = () => screen.queryAllByRole('checkbox').filter((c) => /^Select AK/.test(c.getAttribute('aria-label') ?? ''));
const groupBoxes = () => screen.queryAllByRole('checkbox', { name: /^Select the units of/ });
const waitRows = async () => waitFor(() => expect(unitBoxes().length).toBeGreaterThan(0));
const selectedBar = () => screen.queryByRole('region', { name: 'Selected units' });
const lastSearchOf = (mock: typeof api.listItems) => (mock.mock.calls.at(-1)?.[0] as { search?: string } | undefined)?.search;

describe('seleção na página (visão individual)', () => {
  test('marcar mostra a barra e a dica fica sempre visível', async () => {
    const user = userEvent.setup();
    mount();
    await waitRows();
    expect(screen.getByText('Tick several units to move them together.')).toBeInTheDocument();
    expect(selectedBar()).toBeNull();
    await user.click(unitBoxes()[0]);
    await user.click(unitBoxes()[1]);
    expect(within(selectedBar()!).getByText('2 selected')).toBeInTheDocument();
  });

  test('trocar a aba limpa a seleção', async () => {
    const user = userEvent.setup();
    mount();
    await waitRows();
    await user.click(unitBoxes()[0]);
    expect(selectedBar()).not.toBeNull();
    const tabs = screen.getAllByRole('tab');
    await user.click(tabs[1]);
    await waitFor(() => expect(selectedBar()).toBeNull());
  });

  test('ligar o chip de encalhados limpa a seleção', async () => {
    const user = userEvent.setup();
    mount();
    await waitRows();
    await user.click(unitBoxes()[0]);
    await user.click(screen.getByRole('button', { name: /Stuck only/ }));
    await waitFor(() => expect(selectedBar()).toBeNull());
  });

  test('a busca (Enter) limpa a seleção e grava ?q= na URL; a consulta à API leva search', async () => {
    const user = userEvent.setup();
    mount();
    await waitRows();
    await user.click(unitBoxes()[0]);
    await user.type(screen.getByRole('searchbox', { name: 'Search by name' }), 'redline{Enter}');
    await waitFor(() => expect(nav.state.query).toBe('q=redline'));
    await waitFor(() => expect(selectedBar()).toBeNull());
    await waitFor(() => expect(lastSearchOf(api.listItems)).toBe('redline'));
  });

  test('?q= da URL aparece no campo e vai para a API; "Limpar filtros" apaga o ?q=', async () => {
    const user = userEvent.setup();
    nav.set('q=awp');
    mount();
    expect(screen.getByRole('searchbox', { name: 'Search by name' })).toHaveValue('awp');
    await waitFor(() => expect(lastSearchOf(api.listItems)).toBe('awp'));
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(nav.state.query).toBe(''));
  });

  test('mudança de categoria na URL limpa a seleção; mudar só a ordem não', async () => {
    const user = userEvent.setup();
    mount();
    await waitRows();
    await user.click(unitBoxes()[0]);
    act(() => nav.set('order=asc'));
    await waitRows();
    expect(selectedBar()).not.toBeNull();
    act(() => nav.set('order=asc&category=SKIN'));
    await waitFor(() => expect(selectedBar()).toBeNull());
  });

  test('trocar para a visão agrupada (preferência) limpa a seleção', async () => {
    const user = userEvent.setup();
    const { rerender } = mount();
    await waitRows();
    await user.click(unitBoxes()[0]);
    prefs.view = 'GROUPED';
    rerender(<InventoryPage />);
    await waitFor(() => expect(selectedBar()).toBeNull());
  });

  test('ids que somem depois de uma recarga saem da seleção; os que ficam continuam', async () => {
    const user = userEvent.setup();
    mount();
    await waitRows();
    await user.click(unitBoxes()[0]);
    await user.click(unitBoxes()[1]);
    items = [unit(2), unit(3)]; // o #1 foi vendido
    await user.click(screen.getByRole('button', { name: /Refresh|Reload|Update/i }));
    await waitFor(() => expect(within(selectedBar()!).getByText('1 selected')).toBeInTheDocument());
  });

  test('com o status "Vendido" não há seleção, barra nem dica', async () => {
    nav.set('status=VENDIDO');
    items = [unit(1, { status: 'VENDIDO' })];
    mount();
    await waitFor(() => expect(api.listItems).toHaveBeenCalled());
    await screen.findByText('AK-47 | Linha Vermelha');
    expect(unitBoxes()).toHaveLength(0);
    expect(screen.queryByText('Tick several units to move them together.')).toBeNull();
  });

  test('mover pela barra: abre o diálogo, envia os ids e limpa a seleção ao concluir', async () => {
    const user = userEvent.setup();
    mount();
    await waitRows();
    await user.click(unitBoxes()[0]);
    await user.click(unitBoxes()[2]);
    await user.click(within(selectedBar()!).getByRole('button', { name: 'Move to holding' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('2 units selected.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Move to holding' }));
    await waitFor(() => expect(api.off).toHaveBeenCalledWith({ itemIds: [1, 3] }));
    await waitFor(() => expect(selectedBar()).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('mais de 500 unidades: o botão não abre o diálogo e o motivo aparece', async () => {
    const user = userEvent.setup();
    items = Array.from({ length: 501 }, (_, i) => unit(i + 1));
    mount();
    await waitRows();
    await user.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    const bar = await screen.findByRole('region', { name: 'Selected units' });
    expect(within(bar).getByText('501 selected')).toBeInTheDocument();
    expect(within(bar).getByText('Up to 500 units at a time.')).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Move to holding' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.off).not.toHaveBeenCalled();
  }, 60000);
});

describe('seleção na página (visão agrupada)', () => {
  beforeEach(() => {
    prefs.view = 'GROUPED';
  });

  test('a caixa do grupo marca as unidades dele e desmarca de novo', async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(groupBoxes()).toHaveLength(2));
    await user.click(groupBoxes()[0]);
    expect(within(selectedBar()!).getByText('2 selected')).toBeInTheDocument();
    expect(groupBoxes()[0]).toBeChecked();
    expect(groupBoxes()[1]).not.toBeChecked();
    await user.click(groupBoxes()[0]);
    await waitFor(() => expect(selectedBar()).toBeNull());
  });

  test('mover em grupo envia os ids de todas as unidades marcadas', async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(groupBoxes()).toHaveLength(2));
    await user.click(groupBoxes()[0]);
    await user.click(groupBoxes()[1]);
    await user.click(within(selectedBar()!).getByRole('button', { name: 'Move to holding' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Move to holding' }));
    await waitFor(() => expect(api.off).toHaveBeenCalledWith({ itemIds: [1, 2, 3] }));
  });

  test('a busca na visão agrupada vai para a consulta de grupos', async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(groupBoxes()).toHaveLength(2));
    await user.type(screen.getByRole('searchbox', { name: 'Search by name' }), 'awp{Enter}');
    await waitFor(() => expect(lastSearchOf(api.listItemGroups)).toBe('awp'));
  });
});
