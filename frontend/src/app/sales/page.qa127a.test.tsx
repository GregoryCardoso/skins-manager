// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import SalesSummary from '@/components/SalesSummary';
import { STORES, makeItem } from '@/lib/testFixtures';
import { ApiRequestError } from '@/services/api';
import { renderUi } from '@/test/renderUi';
import type { ItemView, SaleInfo, SalesList, SalesSummary as Summary, UnsellPreview } from '@/types/api';

// QA da 12.7a: filtros que vão para a API e para a URL, resumo, `?item=` e o desfazer venda pela página.
const api = vi.hoisted(() => ({
  listSales: vi.fn(),
  listStores: vi.fn(),
  getUnsellPreview: vi.fn(),
  unsellItem: vi.fn(),
  getSettings: vi.fn(),
}));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));
const nav = vi.hoisted(() => ({ query: '', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/sales',
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => ({ inventoryDensity: 'COMPACT' }) }));
vi.mock('@/components/ImportButton', () => ({ default: () => null }));

import SalesPage from './page';

const INFO: SaleInfo = {
  salePriceUsdCents: 1200, netReceivedUsdCents: 1100, purchaseCostUsdCents: 1000, ownCostUsdCents: 1000, inheritedCostUsdCents: 0,
  fxUsed: { sale: null, purchase: null }, usesRecordedFx: false, approxCurrency: 'BRL',
  approx: { salePrice: 6500, netReceived: 5900, purchaseCost: 5400, profit: 540 },
};

function sold(overrides: Partial<ItemView> = {}): ItemView {
  return makeItem({
    id: 7, status: 'VENDIDO', saleStoreId: 1, salePriceCents: 1200, saleCurrency: 'USD', netReceivedCents: 1100, soldAt: '2026-11-20T12:00:00.000Z',
    saleInfo: INFO, saleProfitUsdCents: 100, purchasePriceCents: 1000, aging: { turnaroundDays: 12, turnaroundBucket: 'GIRO_NORMAL', daysHeld: 30 },
    ...overrides,
  });
}

const SUMMARY: Summary = {
  count: 1, totalSalePriceUsdCents: 1200, totalNetReceivedUsdCents: 1100, totalPurchaseCostUsdCents: 1000, totalProfitUsdCents: 100,
  avgTurnaroundDays: 12, soldWithFxCount: 0, approxCurrency: 'BRL', approx: { totalSalePrice: 6500, totalNetReceived: 5900, totalProfit: 540 },
};

function list(items: ItemView[], summary: Partial<Summary> = {}): SalesList {
  return {
    items,
    summary: { ...SUMMARY, count: items.length, ...summary },
    meta: {
      count: items.length, saleStateCounts: { forSale: 0, offSale: 0 }, fastTurnoverDays: 7, slowItemDays: 21, usdBrlRate: 5.4,
      generatedAt: '2026-11-27T00:00:00.000Z', soldFrom: null, soldTo: null,
    },
  };
}

const preview = (extra: Partial<UnsellPreview> = {}): UnsellPreview => ({
  itemId: 7, storeId: 1, storeName: 'CSFloat', storeCurrency: 'USD', balanceEffectCents: -1100, wasReleased: true, releasesAt: null,
  availableBeforeCents: 84210, availableAfterCents: 83110, pendingBeforeCents: 0, pendingAfterCents: 0, effectUsdCents: -1100,
  approxCents: null, approxCurrency: null, estimated: false, currencyMismatch: false, returnsTo: 'FOR_SALE', ...extra,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderUi(<SalesPage />, { client, withToast: true });
}

const lastQuery = () => api.listSales.mock.calls.at(-1)?.[0];

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  nav.replace.mockReset();
  api.listStores.mockResolvedValue(STORES);
  api.listSales.mockResolvedValue(list([sold()]));
  api.getUnsellPreview.mockResolvedValue(preview());
  api.getSettings.mockResolvedValue({});
  nav.query = '';
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('filtros: o que vai para a API', () => {
  test('sem filtros: só a ordem padrão; loja "Todas" (ALL) nunca vira saleStoreId', async () => {
    renderPage();
    await screen.findByText('AK-47 | Linha Vermelha');
    expect(lastQuery()).toEqual({ sortBy: 'soldAt', order: 'desc' });
    expect(screen.getByRole('combobox', { name: 'Sale store' })).toHaveValue('ALL');
    expect(Object.keys(lastQuery())).not.toContain('saleStoreId');
  });

  test('escolher uma loja grava ?store= na URL; voltar para "Todas" limpa a URL', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('AK-47 | Linha Vermelha');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sale store' }), 'Steam');
    expect(nav.replace).toHaveBeenLastCalledWith('/sales?store=2', { scroll: false });
    cleanup();
    nav.query = 'store=2';
    renderPage();
    await waitFor(() => expect(lastQuery()).toMatchObject({ saleStoreId: 2 }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sale store' }), 'All');
    expect(nav.replace).toHaveBeenLastCalledWith('/sales', { scroll: false });
  });

  test('a loja inativa aparece com "(inactive)" no seletor', async () => {
    renderPage();
    await screen.findByText('AK-47 | Linha Vermelha');
    expect(within(screen.getByRole('combobox', { name: 'Sale store' })).getByRole('option', { name: 'Antiga (inactive)' })).toBeInTheDocument();
  });

  test('?store= inválido (zero, negativo, texto) volta a "Todas" e não vai para a API', async () => {
    for (const bad of ['store=0', 'store=-3', 'store=abc']) {
      nav.query = bad;
      api.listSales.mockClear();
      renderPage();
      await screen.findByText('AK-47 | Linha Vermelha');
      expect(lastQuery()).toEqual({ sortBy: 'soldAt', order: 'desc' });
      cleanup();
    }
  });

  test('preset "Últimos 7 dias": manda soldFrom e soldTo no formato AAAA-MM-DD', async () => {
    nav.query = 'period=LAST_7';
    renderPage();
    await screen.findByText('AK-47 | Linha Vermelha');
    expect(lastQuery().soldFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(lastQuery().soldTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(lastQuery().soldFrom <= lastQuery().soldTo).toBe(true);
  });

  test('período personalizado completo, só com início e só com fim', async () => {
    nav.query = 'period=CUSTOM&from=2026-05-01&to=2026-05-31';
    renderPage();
    await screen.findByText('AK-47 | Linha Vermelha');
    expect(lastQuery()).toEqual({ soldFrom: '2026-05-01', soldTo: '2026-05-31', sortBy: 'soldAt', order: 'desc' });
    cleanup();
    nav.query = 'period=CUSTOM&from=2026-05-01';
    renderPage();
    await waitFor(() => expect(lastQuery()).toEqual({ soldFrom: '2026-05-01', sortBy: 'soldAt', order: 'desc' }));
    cleanup();
    nav.query = 'period=CUSTOM&to=2026-05-31';
    renderPage();
    await waitFor(() => expect(lastQuery()).toEqual({ soldTo: '2026-05-31', sortBy: 'soldAt', order: 'desc' }));
  });

  test('intervalo invertido na URL é ignorado: volta a "All time", sem datas na API e sem campos de data', async () => {
    nav.query = 'period=CUSTOM&from=2026-06-01&to=2026-05-01';
    renderPage();
    await screen.findByText('AK-47 | Linha Vermelha');
    expect(lastQuery()).toEqual({ sortBy: 'soldAt', order: 'desc' });
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('ALL');
    expect(screen.queryByLabelText('From')).toBeNull();
  });

  test('trocar para "Custom" mostra os campos De/Até e grava period=CUSTOM', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('AK-47 | Linha Vermelha');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), 'Custom');
    expect(nav.replace).toHaveBeenLastCalledWith('/sales?period=CUSTOM', { scroll: false });
  });

  test('personalizado: início depois do fim mostra o erro no campo e NÃO muda a URL; um intervalo válido muda', async () => {
    nav.query = 'period=CUSTOM&from=2026-05-01&to=2026-05-31';
    renderPage();
    await screen.findByText('AK-47 | Linha Vermelha');
    const from = screen.getByLabelText('From');
    nav.replace.mockClear();
    fireEvent.change(from, { target: { value: '2026-06-15' } });
    expect(await screen.findByText(/start date cannot be after the end date/)).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
    fireEvent.change(from, { target: { value: '2026-05-10' } });
    await waitFor(() => expect(screen.queryByText(/start date cannot be after the end date/)).toBeNull());
    expect(nav.replace).toHaveBeenLastCalledWith('/sales?period=CUSTOM&from=2026-05-10&to=2026-05-31', { scroll: false });
  });

  test('personalizado: início igual ao fim é válido', async () => {
    nav.query = 'period=CUSTOM&from=2026-05-01&to=2026-05-31';
    renderPage();
    await screen.findByText('AK-47 | Linha Vermelha');
    nav.replace.mockClear();
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-05-01' } });
    expect(screen.queryByText(/start date cannot be after the end date/)).toBeNull();
    expect(nav.replace).toHaveBeenLastCalledWith('/sales?period=CUSTOM&from=2026-05-01&to=2026-05-01', { scroll: false });
  });

  test('personalizado: apagar uma das datas remove o filtro daquele lado', async () => {
    nav.query = 'period=CUSTOM&from=2026-05-01&to=2026-05-31';
    renderPage();
    await screen.findByText('AK-47 | Linha Vermelha');
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '' } });
    expect(nav.replace).toHaveBeenLastCalledWith('/sales?period=CUSTOM&from=2026-05-01', { scroll: false });
  });

  test('"Limpar filtros" só aparece com filtro ativo e leva à URL limpa; "Refresh" busca de novo', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('AK-47 | Linha Vermelha');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    const calls = api.listSales.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.listSales.mock.calls.length).toBeGreaterThan(calls));
    cleanup();
    nav.query = 'store=2&period=THIS_YEAR';
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Clear filters' }));
    expect(nav.replace).toHaveBeenLastCalledWith('/sales', { scroll: false });
  });
});

describe('ordenação pelos cabeçalhos e pelo seletor: só pede à API', () => {
  test('clicar em "Time to sell" grava sort=turnaround&order=asc; a lista não é reordenada no cliente', async () => {
    const user = userEvent.setup();
    const slow = sold({ id: 1, aging: { turnaroundDays: 40, turnaroundBucket: 'DEMOROU_VENDER', daysHeld: 50 }, name: 'Primeiro' });
    const fast = sold({ id: 2, aging: { turnaroundDays: 1, turnaroundBucket: 'GIRO_RAPIDO', daysHeld: 5 }, name: 'Segundo' });
    api.listSales.mockResolvedValue(list([slow, fast]));
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1600);
    renderPage();
    await screen.findAllByText('AK-47 | Linha Vermelha');
    await user.click(within(screen.getByRole('columnheader', { name: /Time to sell/ })).getByRole('button'));
    expect(nav.replace).toHaveBeenLastCalledWith('/sales?sort=turnaround&order=asc', { scroll: false });
    expect([...document.querySelectorAll('tr[data-row-id]')].map((r) => r.getAttribute('data-row-id'))).toEqual(['1', '2']);
  });

  test('?sort=turnaround&order=desc chega na API e no aria-sort', async () => {
    nav.query = 'sort=turnaround&order=desc';
    renderPage();
    await screen.findByText('AK-47 | Linha Vermelha');
    expect(lastQuery()).toEqual({ sortBy: 'turnaround', order: 'desc' });
    expect(screen.getByRole('columnheader', { name: /Time to sell/ })).toHaveAttribute('aria-sort', 'descending');
  });

  test('?sort inválido volta ao padrão; ?sort=turnaround sem order usa asc', async () => {
    nav.query = 'sort=banana&order=sideways';
    renderPage();
    await screen.findByText('AK-47 | Linha Vermelha');
    expect(lastQuery()).toEqual({ sortBy: 'soldAt', order: 'desc' });
    cleanup();
    nav.query = 'sort=turnaround';
    renderPage();
    await waitFor(() => expect(lastQuery()).toEqual({ sortBy: 'turnaround', order: 'asc' }));
  });

  test('o seletor de ordenação traz as 4 opções e escolher uma muda a URL', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('AK-47 | Linha Vermelha');
    const select = screen.getByRole('combobox', { name: 'Sort by' });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Sale date: newest first', 'Sale date: oldest first', 'Time to sell: shortest first', 'Time to sell: longest first',
    ]);
    await user.selectOptions(select, 'Time to sell: longest first');
    expect(nav.replace).toHaveBeenLastCalledWith('/sales?sort=turnaround&order=desc', { scroll: false });
  });
});

describe('resumo', () => {
  const renderSummary = (summary: Partial<Summary>) => renderUi(<SalesSummary summary={{ ...SUMMARY, ...summary }} />);

  test('cinco números: vendas, total vendido, líquido, lucro e tempo médio', () => {
    renderSummary({ count: 3, avgTurnaroundDays: 12.5 });
    const group = screen.getByRole('group', { name: 'Period summary' });
    for (const label of ['Sales', 'Total sold', 'Total net received', 'Profit from sales', 'Average time to sell (after trade lock)']) {
      expect(within(group).getByText(label)).toBeInTheDocument();
    }
    expect(group.textContent).toContain('$12.00');
    expect(group.textContent).toContain('$11.00');
    expect(group.textContent).toContain('+$1.00');
    expect(group.textContent).toContain('12.5 days');
  });

  test('sem vendas (média nula): o tempo médio é o traço e o lucro é neutro', () => {
    renderSummary({ count: 0, avgTurnaroundDays: null, totalProfitUsdCents: 0, totalSalePriceUsdCents: 0, totalNetReceivedUsdCents: 0 });
    const group = screen.getByRole('group', { name: 'Period summary' });
    expect(group.textContent).toContain('—');
    expect(group.textContent).not.toContain('+$');
  });

  test('plural do tempo médio: 1 dia no singular', () => {
    renderSummary({ avgTurnaroundDays: 1 });
    expect(screen.getByText('1 day')).toBeInTheDocument();
  });

  test('prejuízo: o lucro sai negativo e sem "+"', () => {
    renderSummary({ totalProfitUsdCents: -250 });
    const text = screen.getByRole('group', { name: 'Period summary' }).textContent ?? '';
    expect(text).toMatch(/[-−]\$2\.50/);
    expect(text).not.toContain('+$');
  });

  test('a nota "valores em US$ pela cotação gravada" só aparece quando há venda com cotação gravada', () => {
    const none = renderSummary({ soldWithFxCount: 0 });
    expect(none.container.textContent).not.toContain('Amounts in US$');
    cleanup();
    const some = renderSummary({ soldWithFxCount: 2 });
    expect(some.container.textContent).toContain('Amounts in US$, using the rate recorded on each sale.');
  });

  test('sem cotação (≈ nulo): nenhum "≈" aparece', () => {
    renderSummary({ approx: { totalSalePrice: null, totalNetReceived: null, totalProfit: null } as never });
    expect(screen.getByRole('group', { name: 'Period summary' }).textContent).not.toContain('≈');
  });

  test('a página mostra o resumo vindo da API (contagem no subtítulo)', async () => {
    api.listSales.mockResolvedValue(list([sold(), sold({ id: 8 })]));
    renderPage();
    await screen.findAllByText('AK-47 | Linha Vermelha');
    expect(screen.getByText('2 sales')).toBeInTheDocument();
  });
});

describe('?item= destaca a venda', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  test('destaca a linha, rola até ela uma vez e não vira filtro na API', async () => {
    nav.query = 'item=8';
    api.listSales.mockResolvedValue(list([sold({ id: 7 }), sold({ id: 8 })]));
    renderPage();
    await screen.findAllByText('AK-47 | Linha Vermelha');
    const rows = document.querySelectorAll('tr[data-row-id]');
    expect(rows[0]).not.toHaveAttribute('aria-current');
    expect(rows[1]).toHaveAttribute('aria-current', 'true');
    await waitFor(() => expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1));
    expect(lastQuery()).toEqual({ sortBy: 'soldAt', order: 'desc' });
  });

  test('id que não está na lista, ou inválido: nada destacado e nada quebra', async () => {
    for (const bad of ['item=999', 'item=abc', 'item=-1', 'item=']) {
      nav.query = bad;
      renderPage();
      await screen.findByText('AK-47 | Linha Vermelha');
      expect(document.querySelector('tr[aria-current="true"]')).toBeNull();
      expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
      cleanup();
    }
  });
});

describe('desfazer venda pela página', () => {
  async function openUnsell() {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('AK-47 | Linha Vermelha');
    await user.click(screen.getByRole('button', { name: /More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Undo sale' }));
    return user;
  }

  test('venda liberada: mostra o que sai do saldo disponível; confirmar chama a API, avisa e recarrega a lista', async () => {
    api.unsellItem.mockResolvedValue({});
    const user = await openUnsell();
    expect(await screen.findByText(/leaves the available balance of CSFloat/)).toBeInTheDocument();
    expect(screen.getByText('The item goes back to stock, for sale.')).toBeInTheDocument();
    const before = api.listSales.mock.calls.length;
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Undo sale' }));
    await waitFor(() => expect(api.unsellItem).toHaveBeenCalledWith(7));
    expect(await screen.findByText('Sale undone. The item is back in stock.')).toBeInTheDocument();
    await waitFor(() => expect(api.listSales.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  test('venda retida: o texto diz "pending" e o antes/depois usa o pendente', async () => {
    api.getUnsellPreview.mockResolvedValue(preview({ wasReleased: false, releasesAt: '2026-12-01T00:00:00.000Z', pendingBeforeCents: 5000, pendingAfterCents: 3900, availableBeforeCents: 100, availableAfterCents: 100 }));
    await openUnsell();
    expect(await screen.findByText(/leaves the pending balance of CSFloat/)).toBeInTheDocument();
    expect(screen.getByText('$50.00 → $39.00')).toBeInTheDocument();
  });

  test('falha da prévia: aviso, mas o desfazer continua possível', async () => {
    api.getUnsellPreview.mockRejectedValue(new ApiRequestError('INTERNAL_ERROR', 'falhou', 500));
    api.unsellItem.mockResolvedValue({});
    const user = await openUnsell();
    expect(await screen.findByText(/Couldn't work out the effect/)).toBeInTheDocument();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Undo sale' }));
    await waitFor(() => expect(api.unsellItem).toHaveBeenCalledWith(7));
  });

  test('o desfazer devolve 404: avisa que o item sumiu e recarrega a lista', async () => {
    api.unsellItem.mockRejectedValue(new ApiRequestError('ITEM_NOT_FOUND', 'x', 404));
    const user = await openUnsell();
    await screen.findByText(/leaves the available balance/);
    const before = api.listSales.mock.calls.length;
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Undo sale' }));
    expect(await screen.findByText(/This item no longer exists/)).toBeInTheDocument();
    await waitFor(() => expect(api.listSales.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  test('o desfazer devolve 409 (ITEM_NOT_SOLD): o diálogo continua aberto com a mensagem traduzida', async () => {
    api.unsellItem.mockRejectedValue(new ApiRequestError('ITEM_NOT_SOLD', 'x', 409));
    const user = await openUnsell();
    await screen.findByText(/leaves the available balance/);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Undo sale' }));
    expect(await within(screen.getByRole('alertdialog')).findByText('This item has not been sold yet.')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  test('a prévia devolve 404 ou 409: fecha o diálogo, avisa e recarrega a lista (sem mensagem de falha da prévia)', async () => {
    api.getUnsellPreview.mockRejectedValue(new ApiRequestError('ITEM_NOT_SOLD', 'x', 409));
    const before = api.listSales.mock.calls.length;
    await openUnsell();
    expect(await screen.findByText(/This item no longer exists/)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't work out the effect/)).toBeNull();
    await waitFor(() => expect(api.listSales.mock.calls.length).toBeGreaterThan(before));
  });

  test('cancelar não chama o desfazer', async () => {
    const user = await openUnsell();
    await screen.findByText(/leaves the available balance/);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.unsellItem).not.toHaveBeenCalled();
  });

  test('loja em outra moeda (JPY): efeito sem casas decimais', async () => {
    api.getUnsellPreview.mockResolvedValue(preview({ storeCurrency: 'JPY', balanceEffectCents: -150000, availableBeforeCents: 500000, availableAfterCents: 350000 }));
    await openUnsell();
    expect(await screen.findByText(/¥1,500 leaves the available balance/)).toBeInTheDocument();
  });
});
