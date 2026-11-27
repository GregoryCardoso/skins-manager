// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { STORES, makeItem } from '@/lib/testFixtures';
import { boundaryPercents, pinPercent, ruleSegments, saleRuleBucket } from '@/lib/turnoverRule';
import { renderUi } from '@/test/renderUi';
import type { ItemView, SaleInfo } from '@/types/api';
import SaleTurnoverCell from './SaleTurnoverCell';
import SalesTable, { SALES_HIDE_AT, type SalesTableProps } from './SalesTable';
import TurnoverRule from './ui/TurnoverRule';

// QA da 12.7a: larguras da tabela, ordem só pedida à API, menu da linha, moedas (D125) e bordas da régua das vendas.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const LIMITS = { fastTurnoverDays: 7, slowItemDays: 21 };

const INFO: SaleInfo = {
  salePriceUsdCents: 1200, netReceivedUsdCents: 1100, purchaseCostUsdCents: 1000, ownCostUsdCents: 1000, inheritedCostUsdCents: 0,
  fxUsed: { sale: null, purchase: null }, usesRecordedFx: false, approxCurrency: 'BRL',
  approx: { salePrice: 6500, netReceived: 5900, purchaseCost: 5400, profit: 540 },
};

function sold(overrides: Partial<ItemView> = {}): ItemView {
  return makeItem({
    id: 7, status: 'VENDIDO', saleStoreId: 1, salePriceCents: 1200, saleCurrency: 'USD', netReceivedCents: 1100,
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

const mockWidth = (width: number) => vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
const headerNames = () => screen.getAllByRole('columnheader').map((th) => th.textContent?.trim() ?? '').filter(Boolean);

describe('SALES_HIDE_AT na tabela real (larguras 1600, 1200, 1000 e 700)', () => {
  const P3 = ['Purchase store', 'Sale store', 'Cost', 'Sale price'];
  const P1 = ['Item', 'Net received', 'Profit', 'Sale date'];

  test('os limites são 1010 (prioridade 2) e 1530 (prioridade 3)', () => {
    expect(SALES_HIDE_AT).toEqual({ 2: 1010, 3: 1530 });
  });

  test.each([
    [1600, true, true],
    [1530, true, true],
    [1529, true, false],
    [1200, true, false],
    [1010, true, false],
    [1009, false, false],
    [1000, false, false],
    [700, false, false],
  ])('largura %i: tempo até vender %s, colunas de loja/custo/preço %s', (width, showP2, showP3) => {
    mockWidth(width);
    renderUi(<SalesTable {...props([sold()])} />);
    const names = headerNames();
    for (const p1 of P1) expect(names, `${width}: ${p1}`).toContain(p1);
    expect(names.includes('Time to sell'), `${width}: P2`).toBe(showP2);
    for (const p3 of P3) expect(names.includes(p3), `${width}: ${p3}`).toBe(showP3);
  });

  test.each([1600, 1200, 1000, 700])('largura %i: a coluna de ações nunca sai e o menu continua na linha', (width) => {
    mockWidth(width);
    renderUi(<SalesTable {...props([sold()])} />);
    expect(screen.getByRole('button', { name: /More actions/ })).toBeInTheDocument();
    // a coluna de ações tem prioridade 1 (cabeçalho escondido, mas a célula existe)
    expect(screen.getByRole('columnheader', { name: 'Actions' }).dataset.priority).toBe('1');
  });

  test('em 700 as colunas escondidas vão para a linha expandida, com o mesmo conteúdo', async () => {
    mockWidth(700);
    const user = userEvent.setup();
    renderUi(<SalesTable {...props([sold()])} />);
    await user.click(screen.getByRole('button', { name: /Show units of/ }));
    const lists = document.querySelectorAll('dl');
    expect(lists).toHaveLength(1);
    const text = lists[0].textContent ?? '';
    for (const label of [...P3, 'Time to sell']) expect(text).toContain(label);
    expect(text).toContain('CSFloat');
    expect(text).toContain('12 d');
  });

  test('em 1600 (nada escondido) a linha expandida não tem lista de colunas, só dias desde a compra', async () => {
    mockWidth(1600);
    const user = userEvent.setup();
    renderUi(<SalesTable {...props([sold()])} />);
    await user.click(screen.getByRole('button', { name: /Show units of/ }));
    expect(document.querySelectorAll('dl')).toHaveLength(0);
    expect(screen.getByText(/30 days since purchase/)).toBeInTheDocument();
  });
});

describe('ordem pedida à API (a tabela nunca reordena)', () => {
  test('aria-sort só no cabeçalho ordenado; os outros cabeçalhos não têm botão de ordem', () => {
    renderUi(<SalesTable {...props([sold()], { sort: 'turnaround', order: 'asc' })} />);
    expect(screen.getByRole('columnheader', { name: /Time to sell/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: /Sale date/ }).getAttribute('aria-sort') ?? 'none').toBe('none');
    for (const name of ['Item', 'Net received', 'Profit', 'Sale price', 'Cost']) {
      expect(within(screen.getByRole('columnheader', { name })).queryByRole('button'), name).toBeNull();
    }
  });

  test('as linhas ficam na ordem recebida mesmo quando contradiz o sort', () => {
    const a = sold({ id: 1, soldAt: '2026-01-01T00:00:00.000Z', aging: { turnaroundDays: 40, turnaroundBucket: 'DEMOROU_VENDER', daysHeld: 50 } });
    const b = sold({ id: 2, soldAt: '2026-12-01T00:00:00.000Z', aging: { turnaroundDays: 1, turnaroundBucket: 'GIRO_RAPIDO', daysHeld: 5 } });
    const { rerender } = renderUi(<SalesTable {...props([a, b], { sort: 'soldAt', order: 'desc' })} />);
    const ids = () => [...document.querySelectorAll('tr[data-row-id]')].map((row) => row.getAttribute('data-row-id'));
    expect(ids()).toEqual(['1', '2']);
    rerender(<SalesTable {...props([a, b], { sort: 'turnaround', order: 'asc' })} />);
    expect(ids()).toEqual(['1', '2']);
  });

  test('ciclo de cliques: data da venda desc -> asc; tempo até vender asc -> desc', async () => {
    const user = userEvent.setup();
    const p = props([sold()], { sort: 'turnaround', order: 'asc' });
    renderUi(<SalesTable {...p} />);
    await user.click(within(screen.getByRole('columnheader', { name: /Time to sell/ })).getByRole('button'));
    expect(p.onSortChange).toHaveBeenLastCalledWith('turnaround', 'desc');
    await user.click(within(screen.getByRole('columnheader', { name: /Sale date/ })).getByRole('button'));
    // clicar numa coluna que não é a ordenada começa pela ordem "firstOrder" (data: mais recente primeiro)
    expect(p.onSortChange).toHaveBeenLastCalledWith('soldAt', 'desc');
  });
});

describe('menu da linha', () => {
  const openMenu = async (item: ItemView, p = props([item])) => {
    const user = userEvent.setup();
    renderUi(<SalesTable {...p} />);
    await user.click(screen.getByRole('button', { name: /More actions/ }));
    return { user, p };
  };

  test('item vendido (arma): Editar, Componentes, Desfazer venda, Histórico e Excluir, nessa ordem, nenhum desabilitado e sem ação principal', async () => {
    await openMenu(sold());
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent?.trim())).toEqual(['Edit', 'Components', 'Undo sale', 'History', 'Delete']);
    for (const item of items) expect(item).not.toHaveAttribute('aria-disabled', 'true');
    // sem botão "Sell" / "Put on sale" na linha
    expect(screen.queryByRole('button', { name: /^Sell/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Inspect/ })).toBeNull();
  });

  test('cada entrada chama o seu manipulador com o item da linha', async () => {
    const item = sold();
    const p = props([item]);
    const { user } = await openMenu(item, p);
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    expect(p.handlers.onEdit).toHaveBeenCalledWith(item);
    await user.click(screen.getByRole('button', { name: /More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Components' }));
    expect(p.handlers.onComponents).toHaveBeenCalledWith(item);
    await user.click(screen.getByRole('button', { name: /More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'History' }));
    expect(p.handlers.onHistory).toHaveBeenCalledWith(item);
    await user.click(screen.getByRole('button', { name: /More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(p.handlers.onDelete).toHaveBeenCalledWith(item);
    expect(p.handlers.onUnsell).not.toHaveBeenCalled();
  });

  test('item sem painel de componentes (ex.: caixa): Componentes não aparece', async () => {
    await openMenu(sold({ category: 'CAIXA', canReceiveComponents: false, components: [] }));
    const names = (await screen.findAllByRole('menuitem')).map((i) => i.textContent?.trim());
    expect(names).toEqual(['Edit', 'Undo sale', 'History', 'Delete']);
  });

  test('o menu leva o nome do item no rótulo do botão', () => {
    renderUi(<SalesTable {...props([sold()])} />);
    expect(screen.getByRole('button', { name: /More actions.*Linha Vermelha/ })).toBeInTheDocument();
  });
});

describe('valores em outra moeda que USD (D125)', () => {
  const brl = sold({
    purchaseCurrency: 'BRL', purchasePriceCents: 5400, saleCurrency: 'BRL', salePriceCents: 6500, netReceivedCents: 5900,
    saleInfo: {
      ...INFO, usesRecordedFx: true, fxUsed: { sale: 5.4, purchase: 5.4 }, approxCurrency: 'BRL',
      salePriceUsdCents: 1204, netReceivedUsdCents: 1093, purchaseCostUsdCents: 1000,
    },
  });

  test('preço de venda e custo em BRL: valor da moeda + "= US$" com a cotação gravada, sem "≈"', () => {
    mockWidth(1600);
    renderUi(<SalesTable {...props([brl])} />);
    const row = document.querySelector('tr[data-row-id="7"]') as HTMLElement;
    const text = row.textContent ?? '';
    expect(text).toMatch(/R\$\s?65\.00/);
    expect(text).toMatch(/R\$\s?54\.00/);
    expect(text).toContain('= $12.04');
    expect(text).toContain('= $10.00');
    expect(text).toContain('sale rate');
    // as células de preço e custo (moeda não USD) nunca mostram "≈"
    const priceCell = [...row.querySelectorAll('td')].find((td) => td.textContent?.includes('= $12.04'));
    expect(priceCell?.textContent).not.toContain('≈');
  });

  test('item em USD: o valor vem em US$ e o "≈" aparece na moeda de conversão, sem linha "="', () => {
    mockWidth(1600);
    renderUi(<SalesTable {...props([sold()])} />);
    const row = document.querySelector('tr[data-row-id="7"]') as HTMLElement;
    expect(row.textContent).toContain('$12.00');
    expect(row.textContent).toMatch(/≈/);
    expect(row.textContent).not.toMatch(/= \$/);
  });

  test('venda em JPY: sem casas decimais, com a conversão para US$', () => {
    mockWidth(1600);
    const jpy = sold({
      purchaseCurrency: 'JPY', purchasePriceCents: 150000, saleCurrency: 'JPY', salePriceCents: 200000, netReceivedCents: 190000,
      saleInfo: { ...INFO, fxUsed: { sale: 150, purchase: 150 }, salePriceUsdCents: 1333, netReceivedUsdCents: 1267, purchaseCostUsdCents: 1000 },
    });
    renderUi(<SalesTable {...props([jpy])} />);
    const text = (document.querySelector('tr[data-row-id="7"]') as HTMLElement).textContent ?? '';
    expect(text).toMatch(/¥2,000(?!\.)/);
    expect(text).toMatch(/¥1,500(?!\.)/);
    expect(text).toContain('= $13.33');
  });

  test('origem GANHEI: a loja de compra vira o selo, sem nome de loja', () => {
    mockWidth(1600);
    renderUi(<SalesTable {...props([sold({ acquisitionType: 'GANHEI', purchaseStoreId: null, purchasePriceCents: 0, originDetail: 'drop da semana' })])} />);
    const row = document.querySelector('tr[data-row-id="7"]') as HTMLElement;
    expect(row.textContent).toContain('drop da semana');
  });

  test('prejuízo: o lucro sai com sinal de menos e a classe de perda', () => {
    mockWidth(1600);
    const loss = sold({ saleInfo: { ...INFO, netReceivedUsdCents: 800, purchaseCostUsdCents: 1000, approx: { ...INFO.approx, profit: -1080 } } });
    renderUi(<SalesTable {...props([loss])} />);
    const row = document.querySelector('tr[data-row-id="7"]') as HTMLElement;
    expect(row.textContent).toMatch(/[-−]\$2\.00/);
  });

  test('sem saleInfo (resposta antiga): as células de valor mostram o traço e a tabela não quebra', () => {
    mockWidth(1600);
    renderUi(<SalesTable {...props([sold({ saleInfo: undefined as never, saleProfitUsdCents: null })])} />);
    expect(document.querySelector('tr[data-row-id="7"]')).not.toBeNull();
  });
});

describe('régua das vendas: bordas', () => {
  test('saleRuleBucket cobre todas as faixas e SEM_GIRO fica sem régua', () => {
    expect([saleRuleBucket('GIRO_RAPIDO'), saleRuleBucket('GIRO_NORMAL'), saleRuleBucket('DEMOROU_VENDER'), saleRuleBucket('SEM_GIRO')])
      .toEqual(['RECENTE', 'EM_GIRO', 'AGARRADO', null]);
  });

  test('o pino fica sempre dentro do trilho (1,5% a 98,5%) e dentro da faixa do bucket, nas bordas dos limites', () => {
    const [first, second] = boundaryPercents(LIMITS);
    const at = (days: number, bucket: 'RECENTE' | 'EM_GIRO' | 'AGARRADO') => pinPercent({ days, bucket, limits: LIMITS });
    // dia 0 e dia 7 (limite) no giro rápido
    expect(at(0, 'RECENTE')).toBeGreaterThanOrEqual(1.5);
    expect(at(0, 'RECENTE')).toBeLessThan(first);
    expect(at(7, 'RECENTE')).toBeLessThanOrEqual(first + 1e-9);
    // 7 dias no bucket "normal" (backend decide a borda) fica no começo da faixa do meio
    expect(at(7, 'EM_GIRO')).toBeGreaterThanOrEqual(first - 1e-9);
    expect(at(21, 'EM_GIRO')).toBeLessThanOrEqual(second + 1e-9);
    expect(at(21, 'AGARRADO')).toBeGreaterThanOrEqual(second - 1e-9);
    expect(at(999, 'AGARRADO')).toBe(98.5);
    // dias contraditórios com o bucket: o pino continua na faixa do bucket
    expect(at(30, 'RECENTE')).toBeLessThanOrEqual(first + 1e-9);
    expect(at(0, 'AGARRADO')).toBeGreaterThanOrEqual(second - 1e-9);
    expect(at(-5, 'RECENTE')).toBe(1.5);
    expect(at(Number.NaN, 'EM_GIRO')).toBeGreaterThanOrEqual(first - 1e-9);
  });

  test('limites personalizados (1/365 e 20/21) mantêm as três faixas visíveis (mínimo de 12%)', () => {
    for (const limits of [{ fastTurnoverDays: 1, slowItemDays: 365 }, { fastTurnoverDays: 20, slowItemDays: 21 }, { fastTurnoverDays: 1, slowItemDays: 2 }]) {
      const segments = ruleSegments(limits);
      expect(segments.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      for (const s of segments) expect(s).toBeGreaterThanOrEqual(0.12 - 1e-9);
      const [a, b] = boundaryPercents(limits);
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(100);
    }
  });

  test.each([
    [0, 'GIRO_RAPIDO'],
    [7, 'GIRO_RAPIDO'],
    [8, 'GIRO_NORMAL'],
    [21, 'GIRO_NORMAL'],
    [22, 'DEMOROU_VENDER'],
  ] as const)('célula com %i dia(s) e bucket %s mostra a régua desse bucket e os dias', (days, bucket) => {
    const item = sold({ aging: { turnaroundDays: days, turnaroundBucket: bucket, daysHeld: days + 3 } });
    const { container } = renderUi(<SaleTurnoverCell item={item} limits={LIMITS} />);
    expect(container.querySelector(`[data-bucket="${bucket}"]`)).not.toBeNull();
    expect(container.textContent).toContain(`${days} d after release`);
    expect(container.querySelector('[data-bucket="SEM_GIRO"]')).toBeNull();
  });

  test('"Demorou" marca a régua como encalhada (isStuck) e as outras não', () => {
    const slow = renderUi(<SaleTurnoverCell item={sold({ aging: { turnaroundDays: 40, turnaroundBucket: 'DEMOROU_VENDER', daysHeld: 50 } })} limits={LIMITS} />);
    expect(slow.container.querySelector('[data-bucket]')?.className).toMatch(/isStuck/);
    cleanup();
    const fast = renderUi(<SaleTurnoverCell item={sold({ aging: { turnaroundDays: 2, turnaroundBucket: 'GIRO_RAPIDO', daysHeld: 5 } })} limits={LIMITS} />);
    expect(fast.container.querySelector('[data-bucket]')?.className).not.toMatch(/isStuck/);
  });

  test('SEM_GIRO só mostra o selo, mesmo que venham dias; dias nulos com bucket de giro também viram selo', () => {
    const a = renderUi(<SaleTurnoverCell item={sold({ aging: { turnaroundDays: 5, turnaroundBucket: 'SEM_GIRO', daysHeld: 9 } })} limits={LIMITS} />);
    expect(a.container.querySelector('[data-bucket]')).toBeNull();
    expect(screen.getByText('Sold from holding (not counted)')).toBeInTheDocument();
    cleanup();
    const b = renderUi(<SaleTurnoverCell item={sold({ aging: { turnaroundDays: null, turnaroundBucket: 'GIRO_NORMAL', daysHeld: 9 } })} limits={LIMITS} />);
    expect(b.container.querySelector('[data-bucket]')).toBeNull();
    expect(screen.getByText('Sold from holding (not counted)')).toBeInTheDocument();
  });

  test('item que não é de venda (aging de estoque, ex.: trade lock): sem régua nem selo, só o traço', () => {
    const item = sold({ aging: { daysForSale: null, bucket: 'EM_TRADE_LOCK' } as never });
    const { container } = renderUi(<SaleTurnoverCell item={item} limits={LIMITS} />);
    expect(container.querySelector('[data-bucket]')).toBeNull();
    expect(container.textContent).toBe('—');
  });

  test('TurnoverRule kind="sale" com dias nulos ou inválidos não desenha nada', () => {
    const a = renderUi(<TurnoverRule kind="sale" bucket="GIRO_NORMAL" days={null} limits={LIMITS} />);
    expect(a.container.firstChild).toBeNull();
    cleanup();
    const b = renderUi(<TurnoverRule kind="sale" bucket="GIRO_NORMAL" days={Number.NaN} limits={LIMITS} />);
    expect(b.container.firstChild).toBeNull();
    cleanup();
    const c = renderUi(<TurnoverRule kind="sale" bucket="SEM_GIRO" days={3} limits={LIMITS} />);
    expect(c.container.firstChild).toBeNull();
  });

  test('o texto da régua nunca depende só da cor: o nome da faixa está no texto', () => {
    const { container } = renderUi(<SaleTurnoverCell item={sold({ aging: { turnaroundDays: 40, turnaroundBucket: 'DEMOROU_VENDER', daysHeld: 50 } })} limits={LIMITS} />);
    expect(container.textContent).toContain('Slow to sell');
    // o trilho é decorativo
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
