// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { splitColumns } from '@/components/ui/DataTable';
import { STORES, makeItem } from '@/lib/testFixtures';
import { saleRuleBucket } from '@/lib/turnoverRule';
import { loadMessages, renderUi } from '@/test/renderUi';
import type { ItemView, SaleInfo } from '@/types/api';
import SaleTurnoverCell from './SaleTurnoverCell';
import SalesTable, { SALES_HIDE_AT, type SalesTableProps } from './SalesTable';
import { TurnoverLegend } from './ui/TurnoverRule';

afterEach(cleanup);

const LIMITS = { fastTurnoverDays: 7, slowItemDays: 21 };

const INFO: SaleInfo = {
  salePriceUsdCents: 1200, netReceivedUsdCents: 1100, purchaseCostUsdCents: 1000, ownCostUsdCents: 1000, inheritedCostUsdCents: 0,
  fxUsed: { sale: null, purchase: null }, usesRecordedFx: false, approxCurrency: 'BRL',
  approx: { salePrice: 6500, netReceived: 5900, purchaseCost: 5400, profit: 540 },
};

function sold(overrides: Partial<ItemView> = {}): ItemView {
  return makeItem({
    id: 7, status: 'VENDIDO', saleState: null as never, saleStoreId: 1, salePriceCents: 1200, saleCurrency: 'USD', netReceivedCents: 1100,
    soldAt: '2026-11-20T12:00:00.000Z', saleInfo: INFO, saleProfitUsdCents: 100, purchasePriceCents: 1000,
    aging: { turnaroundDays: 12, turnaroundBucket: 'GIRO_NORMAL', daysHeld: 30 },
    ...overrides,
  });
}

function props(items: ItemView[], extra: Partial<SalesTableProps> = {}): SalesTableProps {
  return {
    items, stores: STORES, limits: LIMITS, sort: 'soldAt', order: 'desc', onSortChange: vi.fn(),
    handlers: { onEdit: vi.fn(), onUnsell: vi.fn(), onDelete: vi.fn(), onHistory: vi.fn(), onComponents: vi.fn() },
    ...extra,
  };
}

describe('SalesTable', () => {
  test('prioridades das colunas: líquido, lucro e data sempre; tempo até vender é 2; lojas, custo e preço são 3', () => {
    renderUi(<SalesTable {...props([sold()])} />);
    const priorities = Object.fromEntries(
      screen.getAllByRole('columnheader').filter((th) => th.dataset.priority).map((th) => [th.textContent?.trim() || 'actions', th.dataset.priority]),
    );
    expect(priorities['Net received']).toBe('1');
    expect(priorities['Profit']).toBe('1');
    expect(priorities['Sale date']).toBe('1');
    expect(priorities['Time to sell']).toBe('2');
    expect(priorities['Purchase store']).toBe('3');
    expect(priorities['Sale price']).toBe('3');
  });

  test('os limites de esconder tiram as colunas 2 e 3 antes de a de ações ir para trás da rolagem', () => {
    const cols = [
      { id: 'a', header: 'a', cell: () => null, priority: 1 as const },
      { id: 'b', header: 'b', cell: () => null, priority: 2 as const },
      { id: 'c', header: 'c', cell: () => null, priority: 3 as const },
    ];
    expect(splitColumns(cols, 1440 - 280, SALES_HIDE_AT).hidden.map((c) => c.id)).toEqual(['c']);
    expect(splitColumns(cols, 900, SALES_HIDE_AT).hidden.map((c) => c.id)).toEqual(['b', 'c']);
    expect(splitColumns(cols, 1600, SALES_HIDE_AT).hidden).toEqual([]);
  });

  test('o menu tem Editar, Desfazer venda, Histórico e Excluir e chama os manipuladores', async () => {
    const user = userEvent.setup();
    const p = props([sold()]);
    renderUi(<SalesTable {...p} />);
    await user.click(screen.getByRole('button', { name: /More actions/ }));
    for (const name of ['Edit', 'Undo sale', 'History', 'Delete']) expect(await screen.findByRole('menuitem', { name })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Undo sale' }));
    expect(p.handlers.onUnsell).toHaveBeenCalledTimes(1);
  });

  test('clicar no cabeçalho só pede a ordem (a tabela não reordena)', async () => {
    const user = userEvent.setup();
    const p = props([sold({ id: 1 }), sold({ id: 2 })]);
    renderUi(<SalesTable {...p} sort="soldAt" order="desc" />);
    const header = screen.getByRole('columnheader', { name: /Sale date/ });
    expect(header).toHaveAttribute('aria-sort', 'descending');
    await user.click(within(header).getByRole('button'));
    expect(p.onSortChange).toHaveBeenCalledWith('soldAt', 'asc');
    await user.click(within(screen.getByRole('columnheader', { name: /Time to sell/ })).getByRole('button'));
    expect(p.onSortChange).toHaveBeenCalledWith('turnaround', 'asc');
  });

  test('a linha expandida mostra os dias desde a compra e as cotações gravadas', async () => {
    const user = userEvent.setup();
    const item = sold({ saleInfo: { ...INFO, usesRecordedFx: true, fxUsed: { sale: 5.4, purchase: 5.1 } } });
    renderUi(<SalesTable {...props([item])} />);
    await user.click(screen.getByRole('button', { name: /Show units of/ }));
    expect(screen.getByText(/since purchase/)).toBeInTheDocument();
    expect(screen.getByText(/Recorded rates: sale/)).toBeInTheDocument();
  });

  test('?item= destaca a linha com aria-current e a legenda da régua fica visível', () => {
    renderUi(<SalesTable {...props([sold({ id: 7 }), sold({ id: 8 })], { highlightedItemId: 7 })} />);
    const rows = document.querySelectorAll('tr[data-row-id]');
    expect(rows[0]).toHaveAttribute('aria-current', 'true');
    expect(rows[1]).not.toHaveAttribute('aria-current');
    expect(screen.getAllByText(/Days counted from the end/).length).toBeGreaterThan(0);
  });

  test('lista vazia mostra o conteúdo de empty', () => {
    renderUi(<SalesTable {...props([], { empty: <p>nada aqui</p> })} />);
    expect(screen.getByText('nada aqui')).toBeInTheDocument();
  });
});

describe('SaleTurnoverCell', () => {
  test.each([
    ['GIRO_RAPIDO', 3, 'Fast turnover'],
    ['GIRO_NORMAL', 12, 'Normal turnover'],
    ['DEMOROU_VENDER', 40, 'Slow to sell'],
  ] as const)('%s tem régua com o texto da faixa', (bucket, days, label) => {
    const item = sold({ aging: { turnaroundDays: days, turnaroundBucket: bucket, daysHeld: 50 } });
    const { container } = renderUi(<SaleTurnoverCell item={item} limits={LIMITS} />);
    expect(container.querySelector(`[data-bucket="${bucket}"]`)).not.toBeNull();
    expect(container.textContent).toContain(label);
    expect(container.textContent).toContain(`${days} d after release`);
  });

  test('SEM_GIRO (vendido do holding) não tem régua, só o selo', () => {
    const item = sold({ aging: { turnaroundDays: null, turnaroundBucket: 'SEM_GIRO', daysHeld: 20 } });
    const { container } = renderUi(<SaleTurnoverCell item={item} limits={LIMITS} />);
    expect(container.querySelector('[data-bucket]')).toBeNull();
    expect(screen.getByText('Sold from holding (not counted)')).toBeInTheDocument();
  });

  test('plural em pt-BR e ru na forma "depois de liberar"', async () => {
    const item = sold({ aging: { turnaroundDays: 21, turnaroundBucket: 'GIRO_NORMAL', daysHeld: 50 } });
    const pt = renderUi(<SaleTurnoverCell item={item} limits={LIMITS} />, { language: 'pt-BR', messages: await loadMessages('pt-BR') });
    expect(pt.container.textContent).toContain('21 d após liberar');
    cleanup();
    const ru = renderUi(<SaleTurnoverCell item={item} limits={LIMITS} />, { language: 'ru', messages: await loadMessages('ru') });
    expect(ru.container.textContent).toContain('21 дн. после разблокировки');
  });
});

describe('legenda e geometria da régua das vendas', () => {
  test('a legenda mostra os limites vindos das configurações', () => {
    renderUi(<TurnoverLegend variant="sale" limits={{ fastTurnoverDays: 5, slowItemDays: 30 }} />);
    expect(screen.getByText('Fast turnover up to 5 days')).toBeInTheDocument();
    expect(screen.getByText('Slow to sell above 30 days')).toBeInTheDocument();
    expect(screen.getByText(/Days counted from the end of the trade lock/)).toBeInTheDocument();
  });

  test('saleRuleBucket mapeia as três faixas e deixa SEM_GIRO sem régua', () => {
    expect(saleRuleBucket('GIRO_RAPIDO')).toBe('RECENTE');
    expect(saleRuleBucket('GIRO_NORMAL')).toBe('EM_GIRO');
    expect(saleRuleBucket('DEMOROU_VENDER')).toBe('AGARRADO');
    expect(saleRuleBucket('SEM_GIRO')).toBeNull();
  });
});
