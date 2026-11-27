// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import InventoryGroupTable from '@/components/InventoryGroupTable';
import InventoryTable from '@/components/InventoryTable';
import { PreferencesProvider, usePreferences } from '@/components/PreferencesProvider';
import { DEFAULT_FILTERS, toApiQuery } from '@/lib/inventoryQuery';
import { STORES, makeItem } from '@/lib/testFixtures';
import { loadMessages, renderUi } from '@/test/renderUi';
import type { ItemGroup, ItemView } from '@/types/api';
import InventoryToolbar from './InventoryToolbar';
import type { UnitRowHandlers } from './ItemRowActions';

// QA da 12.5a: bordas das tabelas e da barra do inventário (aria-sort, largura, destaque, plural, densidade otimista).
const mocks = vi.hoisted(() => ({ getSettings: vi.fn(), updatePreferences: vi.fn() }));
vi.mock('@/services/api', () => ({
  getSettings: mocks.getSettings,
  updatePreferences: mocks.updatePreferences,
  changeDisplayCurrency: vi.fn(),
  refreshFxRate: vi.fn(),
  updateFxRate: vi.fn(),
}));
vi.mock('@/components/useMarketSummary', () => ({ useMarketSummary: () => ({ summary: null, refreshing: false }) }));

beforeEach(() => {
  mocks.getSettings.mockReset();
  mocks.updatePreferences.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const LIMITS = { fastTurnoverDays: 7, slowItemDays: 21 };
const noop = () => {};
const handlers = (): UnitRowHandlers => ({
  onEdit: vi.fn(), onSell: vi.fn(), onUnsell: vi.fn(), onDelete: vi.fn(), onHistory: vi.fn(), onOffSale: vi.fn(), onForSale: vi.fn(),
  onApply: vi.fn(), onOpen: vi.fn(), onRegisterKey: vi.fn(), onDetach: vi.fn(),
});

function makeGroup(units: ItemView[], overrides: Partial<ItemGroup> = {}): ItemGroup {
  return {
    key: 'k1', name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', exterior: 'FT', phase: null, catalog: null,
    quantity: units.length, totalCostUsdCents: 300, avgCostUsdCents: 150, costUsesRecordedFx: false, approxCurrency: 'USD', approx: null,
    componentUnits: 0, stagnantCount: 0, stock: { total: units.length, forSale: units.length, tradeLocked: 0, offSale: 0, nextUnlockAt: null }, units,
    ...overrides,
  };
}

function mockWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
}

const baseGroupProps = {
  stores: STORES, limits: LIMITS, density: 'compact' as const, order: 'desc' as const, onOrderChange: noop, onToggle: noop, expandedKeys: new Set<string>(),
};

describe('aria-sort e ordem que vai para a API', () => {
  test('individual: asc e desc aparecem no aria-sort; clicar alterna o pedido; só o Giro é ordenável', async () => {
    const user = userEvent.setup();
    const onOrderChange = vi.fn();
    const { rerender } = renderUi(
      <InventoryTable items={[makeItem()]} stores={STORES} handlers={handlers()} limits={LIMITS} density="compact" order="asc" onOrderChange={onOrderChange} />,
    );
    const header = screen.getByRole('columnheader', { name: /Turnover/ });
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    await user.click(within(header).getByRole('button'));
    expect(onOrderChange).toHaveBeenLastCalledWith('desc');
    // nenhuma outra coluna ordena
    expect(document.querySelectorAll('th[aria-sort]')).toHaveLength(1);
    rerender(<InventoryTable items={[makeItem()]} stores={STORES} handlers={handlers()} limits={LIMITS} density="compact" order="desc" onOrderChange={onOrderChange} />);
    expect(screen.getByRole('columnheader', { name: /Turnover/ })).toHaveAttribute('aria-sort', 'descending');
  });

  test('agrupada: aria-sort e onOrderChange, e a ordem das linhas é a da API (nada reordena)', async () => {
    const user = userEvent.setup();
    const onOrderChange = vi.fn();
    const groups = [makeGroup([makeItem({ id: 1 })], { key: 'z', name: 'Zeta' }), makeGroup([makeItem({ id: 2 })], { key: 'a', name: 'Alpha' })];
    renderUi(<InventoryGroupTable {...baseGroupProps} order="asc" onOrderChange={onOrderChange} groups={groups} handlers={handlers()} />);
    const header = screen.getByRole('columnheader', { name: /Turnover/ });
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    await user.click(within(header).getByRole('button'));
    expect(onOrderChange).toHaveBeenCalledWith('desc');
    const keys = Array.from(document.querySelectorAll('tr[data-row-id]')).map((row) => row.getAttribute('data-row-id'));
    expect(keys).toEqual(['z', 'a']);
  });

  test('a consulta da API leva a ordem escolhida e stagnantOnly só quando o chip vale', () => {
    expect(toApiQuery({ ...DEFAULT_FILTERS, order: 'asc' })).toMatchObject({ order: 'asc' });
    expect(toApiQuery({ ...DEFAULT_FILTERS, stagnant: true })).toMatchObject({ stagnantOnly: true });
    expect(toApiQuery({ ...DEFAULT_FILTERS, stagnant: true, status: 'VENDIDO' })).not.toHaveProperty('stagnantOnly');
    expect(toApiQuery({ ...DEFAULT_FILTERS, stagnant: true, status: 'EM_ESTOQUE', saleState: 'OFF_SALE' })).not.toHaveProperty('stagnantOnly');
  });
});

describe('expansão e destaque (?item=)', () => {
  const units = [makeItem({ id: 1, floatValue: 0.11 }), makeItem({ id: 2, floatValue: 0.22 })];

  test('recolhido não mostra as unidades; expandido mostra e aria-expanded acompanha', () => {
    const { rerender } = renderUi(<InventoryGroupTable {...baseGroupProps} groups={[makeGroup(units)]} handlers={handlers()} />);
    expect(screen.queryByText(/float 0\.11/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Show units of AK-47 | Redline' })).toHaveAttribute('aria-expanded', 'false');
    rerender(<InventoryGroupTable {...baseGroupProps} expandedKeys={new Set(['k1'])} groups={[makeGroup(units)]} handlers={handlers()} />);
    expect(screen.getByText(/float 0\.11/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide units of AK-47 | Redline' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('o destaque cai só na unidade apontada, com a linha do grupo intacta', () => {
    const { container } = renderUi(
      <InventoryGroupTable {...baseGroupProps} expandedKeys={new Set(['k1'])} highlightedItemId={2} groups={[makeGroup(units)]} handlers={handlers()} />,
    );
    expect(container.querySelector('tr[data-row-id="2"]')).toHaveAttribute('aria-current', 'true');
    expect(container.querySelector('tr[data-row-id="1"]')).not.toHaveAttribute('aria-current');
    expect(container.querySelector('tr[data-row-id="k1"]')).not.toHaveAttribute('aria-current');
  });

  test('destaque de um id que não existe não marca nada', () => {
    const { container } = renderUi(
      <InventoryTable items={[makeItem({ id: 1 })]} stores={STORES} handlers={handlers()} limits={LIMITS} density="compact" order="desc" onOrderChange={noop} highlightedItemId={999} />,
    );
    expect(container.querySelector('[aria-current="true"]')).toBeNull();
  });

  test('densidade confortável chega também às tabelas da visão agrupada (grupo e unidades)', () => {
    const { container } = renderUi(
      <InventoryGroupTable {...baseGroupProps} density="comfortable" expandedKeys={new Set(['k1'])} groups={[makeGroup(units)]} handlers={handlers()} />,
    );
    const tables = container.querySelectorAll('table');
    expect(tables.length).toBe(2);
    tables.forEach((table) => expect(table).toHaveAttribute('data-density', 'comfortable'));
  });
});

describe('colunas escondidas pela largura', () => {
  const item = makeItem({ id: 5, floatValue: 0.2 });

  test('sem largura medida (jsdom) todas as colunas aparecem', () => {
    renderUi(<InventoryTable items={[item]} stores={STORES} handlers={handlers()} limits={LIMITS} density="compact" order="desc" onOrderChange={noop} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(['Purchase store', 'Cost', 'Turnover', 'Days']));
    expect(screen.queryByRole('button', { name: /Show details|Show units/ })).toBeNull();
  });

  test('tabela estreita (600 px): saem loja, custo e as de prioridade 3; ficam item, preço, giro e ações; aparece o expansor', async () => {
    mockWidth(600);
    const user = userEvent.setup();
    renderUi(<InventoryTable items={[item]} stores={STORES} handlers={handlers()} limits={LIMITS} density="compact" order="desc" onOrderChange={noop} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '');
    expect(headers.some((h) => /Purchase store/.test(h))).toBe(false);
    expect(headers.some((h) => /Turnover/.test(h))).toBe(true);
    expect(headers.some((h) => /Break-even|Min/i.test(h))).toBe(true);
    // a coluna escondida vai para a linha expandida, aberta pelo botão da linha
    const expander = screen.getAllByRole('button').find((b) => b.hasAttribute('aria-expanded'));
    expect(expander).toBeDefined();
    await user.click(expander!);
    expect(await screen.findByText('Purchase store', { selector: 'dt' })).toBeInTheDocument();
  });

  // Limites do inventário (INVENTORY_HIDE_AT): prioridade 3 sai abaixo de 1280 px de tabela e a 2 abaixo de 1000.
  test('tabela média (1100 px): só as de prioridade 3 saem', () => {
    mockWidth(1100);
    renderUi(<InventoryTable items={[item]} stores={STORES} handlers={handlers()} limits={LIMITS} density="compact" order="desc" onOrderChange={noop} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '');
    expect(headers).toContain('Purchase store');
    expect(headers.some((h) => /Days/i.test(h))).toBe(false);
  });

  test('tabela de 900 px: saem também as de prioridade 2 (loja de compra)', () => {
    mockWidth(900);
    renderUi(<InventoryTable items={[item]} stores={STORES} handlers={handlers()} limits={LIMITS} density="compact" order="desc" onOrderChange={noop} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '');
    expect(headers).not.toContain('Purchase store');
    expect(headers.some((h) => /Turnover/.test(h))).toBe(true);
  });

  test('tabela larga (1300 px): todas aparecem', () => {
    mockWidth(1300);
    renderUi(<InventoryTable items={[item]} stores={STORES} handlers={handlers()} limits={LIMITS} density="compact" order="desc" onOrderChange={noop} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '');
    expect(headers).toContain('Purchase store');
    expect(headers.some((h) => /Days/i.test(h))).toBe(true);
  });

  test('a agrupada estreita mantém a quantidade e o expansor de unidades', () => {
    mockWidth(600);
    renderUi(<InventoryGroupTable {...baseGroupProps} groups={[makeGroup([makeItem({ id: 1 })])]} handlers={handlers()} />);
    expect(screen.getByRole('button', { name: 'Show units of AK-47 | Redline' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Qty./ })).toBeInTheDocument();
  });
});

describe('vazio, carregando e erro nas duas visões', () => {
  test('agrupada: vazio mostra o conteúdo recebido e carregando põe aria-busy e esqueleto no lugar das linhas', () => {
    const { container, rerender } = renderUi(<InventoryGroupTable {...baseGroupProps} groups={[]} handlers={handlers()} empty={<p>Vazio aqui</p>} />);
    expect(screen.getByText('Vazio aqui')).toBeInTheDocument();
    expect(container.querySelector('tr[data-row-id]')).toBeNull();
    rerender(<InventoryGroupTable {...baseGroupProps} groups={[]} handlers={handlers()} loading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText('Vazio aqui')).toBeNull();
  });

  test('a legenda da régua aparece no rodapé das duas tabelas, com o limite configurado', () => {
    const custom = { fastTurnoverDays: 3, slowItemDays: 10 };
    const { rerender } = renderUi(<InventoryTable items={[makeItem()]} stores={STORES} handlers={handlers()} limits={custom} density="compact" order="desc" onOrderChange={noop} />);
    expect(screen.getByText(/Stuck above 10 days/)).toBeInTheDocument();
    rerender(<InventoryGroupTable {...baseGroupProps} limits={custom} groups={[makeGroup([makeItem()])]} handlers={handlers()} />);
    expect(screen.getByText(/Stuck above 10 days/)).toBeInTheDocument();
  });
});

describe('selo de encalhados no plural (pt-BR, ru, pl)', () => {
  const unit = [makeItem({ id: 1 })];
  const badge = async (language: 'pt-BR' | 'ru' | 'pl', count: number) => {
    const { container, unmount } = renderUi(
      <InventoryGroupTable {...baseGroupProps} groups={[makeGroup(unit, { stagnantCount: count })]} handlers={handlers()} />,
      { language, messages: await loadMessages(language) },
    );
    const text = container.querySelector('[data-tone="stuck"], .badge')?.textContent;
    const all = container.textContent ?? '';
    unmount();
    return text ?? all;
  };

  test.each([
    ['pt-BR', 1, '1 encalhada'], ['pt-BR', 2, '2 encalhadas'],
    ['ru', 1, '1 залежался'], ['ru', 3, '3 залежались'], ['ru', 5, '5 залежались'], ['ru', 21, '21 залежался'],
    ['pl', 1, '1 zalegający'], ['pl', 3, '3 zalegające'], ['pl', 5, '5 zalegających'], ['pl', 22, '22 zalegające'],
  ] as const)('%s com %i -> %s', async (language, count, expected) => {
    expect(await badge(language, count)).toContain(expected);
  });

  test('sem encalhados não há selo', async () => {
    const { container } = renderUi(<InventoryGroupTable {...baseGroupProps} groups={[makeGroup(unit, { stagnantCount: 0 })]} handlers={handlers()} />);
    expect(container.textContent).not.toMatch(/stuck/);
  });
});

describe('InventoryToolbar: chip e densidade', () => {
  const props = {
    slowItemDays: 21, loading: false, view: 'GROUPED' as const, groupedAvailable: true, onViewChange: vi.fn(), density: 'COMPACT' as const,
    onDensityChange: vi.fn(), onChange: vi.fn(), onClear: vi.fn(), onRefresh: vi.fn(),
  };

  test('o chip fica desabilitado em Vendido e no holding, e habilitado em Todos e em estoque à venda', () => {
    const chip = () => screen.getByRole('button', { name: /Stuck only/ });
    const { rerender } = renderUi(<InventoryToolbar {...props} filters={{ ...DEFAULT_FILTERS, status: 'VENDIDO' }} />);
    expect(chip()).toBeDisabled();
    rerender(<InventoryToolbar {...props} filters={{ ...DEFAULT_FILTERS, status: 'EM_ESTOQUE', saleState: 'OFF_SALE' }} />);
    expect(chip()).toBeDisabled();
    rerender(<InventoryToolbar {...props} filters={{ ...DEFAULT_FILTERS, status: 'EM_ESTOQUE', saleState: 'FOR_SALE' }} />);
    expect(chip()).toBeEnabled();
    rerender(<InventoryToolbar {...props} filters={{ ...DEFAULT_FILTERS, status: 'ALL' }} />);
    expect(chip()).toBeEnabled();
  });

  test('com stagnant ligado e o chip desabilitado, ele aparece solto (aria-pressed=false)', () => {
    renderUi(<InventoryToolbar {...props} filters={{ ...DEFAULT_FILTERS, status: 'VENDIDO', stagnant: true }} />);
    expect(screen.getByRole('button', { name: /Stuck only/ })).toHaveAttribute('aria-pressed', 'false');
  });

  test('o chip leva o limite configurado no rótulo', () => {
    renderUi(<InventoryToolbar {...props} slowItemDays={30} filters={DEFAULT_FILTERS} />);
    expect(screen.getByRole('button', { name: /Stuck only \(for sale for more than 30 days\)/ })).toBeInTheDocument();
  });

  test('a densidade atual está marcada e a troca chama o manipulador uma vez', async () => {
    const user = userEvent.setup();
    const onDensityChange = vi.fn();
    renderUi(<InventoryToolbar {...props} density="COMFORTABLE" onDensityChange={onDensityChange} filters={DEFAULT_FILTERS} />);
    expect(screen.getByRole('radio', { name: 'Comfortable' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Compact' }));
    expect(onDensityChange).toHaveBeenCalledTimes(1);
    expect(onDensityChange).toHaveBeenCalledWith('COMPACT');
  });

  test('Limpar filtros só aparece com filtro ativo', () => {
    const { rerender } = renderUi(<InventoryToolbar {...props} filters={DEFAULT_FILTERS} />);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    rerender(<InventoryToolbar {...props} filters={{ ...DEFAULT_FILTERS, category: 'FACA' }} />);
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });
});

describe('densidade otimista com o PreferencesProvider real e a barra', () => {
  const settings = (density: 'COMPACT' | 'COMFORTABLE') => ({
    theme: 'LIGHT', language: 'en', inventoryView: 'GROUPED', inventoryDensity: density, displayCurrency: 'USD', fxRates: [], requiredFxCurrencies: [],
  });

  function Harness() {
    const { inventoryDensity, setInventoryDensity } = usePreferences();
    return (
      <InventoryToolbar
        filters={DEFAULT_FILTERS} slowItemDays={21} loading={false} view="GROUPED" groupedAvailable onViewChange={noop}
        density={inventoryDensity} onDensityChange={(next) => { void setInventoryDensity(next); }} onChange={noop} onClear={noop} onRefresh={noop}
      />
    );
  }
  const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  test('a escolha aparece marcada na hora e, se o PATCH falhar, o controle volta ao valor anterior', async () => {
    const user = userEvent.setup();
    mocks.getSettings.mockResolvedValue(settings('COMPACT'));
    let reject: (error: Error) => void = noop;
    mocks.updatePreferences.mockImplementation(() => new Promise((_resolve, rej) => { reject = rej; }));
    renderUi(<PreferencesProvider><Harness /></PreferencesProvider>, { client: client() });
    await waitFor(() => expect(mocks.getSettings).toHaveBeenCalled());
    await user.click(screen.getByRole('radio', { name: 'Comfortable' }));
    expect(screen.getByRole('radio', { name: 'Comfortable' })).toBeChecked();
    expect(mocks.updatePreferences).toHaveBeenCalledWith({ inventoryDensity: 'COMFORTABLE' });
    reject(new Error('falhou'));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Compact' })).toBeChecked());
    expect(screen.getByRole('radio', { name: 'Comfortable' })).not.toBeChecked();
  });

  test('com o PATCH funcionando o valor novo fica', async () => {
    const user = userEvent.setup();
    mocks.getSettings.mockResolvedValue(settings('COMPACT'));
    mocks.updatePreferences.mockResolvedValue(undefined);
    renderUi(<PreferencesProvider><Harness /></PreferencesProvider>, { client: client() });
    await waitFor(() => expect(mocks.getSettings).toHaveBeenCalled());
    mocks.getSettings.mockResolvedValue(settings('COMFORTABLE'));
    await user.click(screen.getByRole('radio', { name: 'Comfortable' }));
    await waitFor(() => expect(mocks.updatePreferences).toHaveBeenCalled());
    expect(screen.getByRole('radio', { name: 'Comfortable' })).toBeChecked();
  });
});
