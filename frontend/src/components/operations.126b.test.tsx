// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeItem, STORES } from '@/lib/testFixtures';
import { renderUi } from '@/test/renderUi';
import type { ApplyCandidate, ItemComponent, OpenOptions } from '@/types/api';

const api = vi.hoisted(() => ({
  getOpenOptions: vi.fn(),
  openContainer: vi.fn(),
  getCatalogStatus: vi.fn(),
  searchCatalog: vi.fn(),
  getApplyCandidates: vi.fn(),
  applyComponent: vi.fn(),
  getDetachPreview: vi.fn(),
  detachComponent: vi.fn(),
}));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));
vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => ({ usdBrlRate: 5, fxRates: [{ currency: 'BRL', rate: 5 }] }) }));

import ApplyComponentModal from './ApplyComponentModal';
import DetachComponentModal from './DetachComponentModal';
import ItemHistoryBox from './ItemHistoryBox';
import OpenContainerModal from './OpenContainerModal';

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const options = (extra: Partial<OpenOptions> = {}): OpenOptions => ({
  kind: 'CASE', containerName: 'Revolution Case', requiredKeyName: 'Revolution Case Key', keys: [], otherKeysInStock: 0, steamStore: null, defaultFxRate: null, ...extra,
});

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getCatalogStatus.mockResolvedValue({ countsBySource: { PATCHES: 0 } });
  api.searchCatalog.mockResolvedValue({ items: [], meta: { catalogUpdatedAt: null, total: 0 } });
});
afterEach(cleanup);

describe('OpenContainerModal', () => {
  const container = (kind: 'CASE' | 'TERMINAL') => makeItem({
    id: 10, name: kind === 'CASE' ? 'Revolution Case' : 'Terminal', category: 'CAIXA',
    openable: { kind, compatibleKeys: 0, otherKeysInStock: 0, otherKeyNames: [], requiredKeyName: 'Revolution Case Key' },
  });

  test('caixa sem chave: aviso com o nome da chave e a ação "Cadastrar chave"', async () => {
    api.getOpenOptions.mockResolvedValue(options());
    const onRegisterKey = vi.fn();
    renderUi(
      <OpenContainerModal item={container('CASE')} stores={STORES} onClose={vi.fn()} onDone={vi.fn()} onGone={vi.fn()} onRegisterKey={onRegisterKey} />,
      { client: client() },
    );
    expect(await screen.findByText(/There is no compatible key in stock. Register Revolution Case Key first./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Register key' }));
    expect(onRegisterKey).toHaveBeenCalledWith('Revolution Case Key');
    expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled();
  });

  test('terminal sem loja Steam: "Comprar" mostra o aviso com o link para Lojas e bloqueia o envio', async () => {
    api.getOpenOptions.mockResolvedValue(options({ kind: 'TERMINAL', requiredKeyName: null }));
    renderUi(
      <OpenContainerModal item={container('TERMINAL')} stores={STORES} onClose={vi.fn()} onDone={vi.fn()} onGone={vi.fn()} onRegisterKey={vi.fn()} />,
      { client: client() },
    );
    await userEvent.click(await screen.findByRole('radio', { name: 'Buy the item' }));
    expect(screen.getByText(/choose your Steam store on the Stores page/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Stores' })).toHaveAttribute('href', '/stores');
    expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled();
  });

  test('terminal com loja Steam: o preço pago é obrigatório (campo com a moeda da loja)', async () => {
    api.getOpenOptions.mockResolvedValue(options({ kind: 'TERMINAL', requiredKeyName: null, steamStore: { id: 2, name: 'Steam', currency: 'BRL' }, defaultFxRate: 5 }));
    renderUi(
      <OpenContainerModal item={container('TERMINAL')} stores={STORES} onClose={vi.fn()} onDone={vi.fn()} onGone={vi.fn()} onRegisterKey={vi.fn()} />,
      { client: client() },
    );
    await userEvent.click(await screen.findByRole('radio', { name: 'Buy the item' }));
    expect(screen.getByLabelText(/Price paid \(BRL\)/)).toBeRequired();
    expect(screen.getByLabelText(/USD→BRL rate/)).toHaveValue('5');
  });
});

describe('ApplyComponentModal', () => {
  const candidate = (id: number, extra: Partial<ApplyCandidate> = {}): ApplyCandidate => ({
    itemId: id, kind: 'STICKER', catalogId: `s-${id}`, name: `Sticker | Cool ${id}`, localizedName: null, imageUrl: null,
    acquiredAt: '2026-11-01T12:00:00.000Z', effectiveCostUsdCents: 100 + id, costEstimated: false, tradeLocked: false, offSale: false, ...extra,
  });

  test('várias unidades: Select com a candidata; aplicar envia a escolhida', async () => {
    api.getApplyCandidates.mockResolvedValue({
      allowedKinds: ['STICKER'], remaining: { stickers: 5, hanging: 1, patches: 3 }, candidates: [candidate(1), candidate(2, { tradeLocked: true })],
    });
    api.applyComponent.mockResolvedValue({});
    const onDone = vi.fn();
    renderUi(
      <ApplyComponentModal target={{ id: 5, name: 'AK-47 | Redline' }} mode={{ type: 'stock' }} onClose={vi.fn()} onDone={onDone} onGone={vi.fn()} />,
      { client: client() },
    );
    const select = await screen.findByLabelText('Unit from stock');
    await userEvent.selectOptions(select, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(api.applyComponent).toHaveBeenCalledTimes(1));
    expect(api.applyComponent.mock.calls[0][0]).toBe(5);
    expect(api.applyComponent.mock.calls[0][1]).toMatchObject({ sourceItemId: 2 });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  test('limite atingido: aviso e o botão Aplicar desabilitado', async () => {
    api.getApplyCandidates.mockResolvedValue({
      allowedKinds: ['STICKER'], remaining: { stickers: 0, hanging: 1, patches: 3 }, candidates: [candidate(1)],
    });
    renderUi(
      <ApplyComponentModal target={{ id: 5, name: 'AK-47 | Redline' }} mode={{ type: 'stock' }} onClose={vi.fn()} onDone={vi.fn()} onGone={vi.fn()} />,
      { client: client() },
    );
    expect(await screen.findByText('This item already has 5 stickers.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  test('sem candidatas: mensagem de vazio', async () => {
    api.getApplyCandidates.mockResolvedValue({ allowedKinds: [], remaining: { stickers: 5, hanging: 1, patches: 3 }, candidates: [] });
    renderUi(
      <ApplyComponentModal target={{ id: 5, name: 'AK-47 | Redline' }} mode={{ type: 'stock' }} onClose={vi.fn()} onDone={vi.fn()} onGone={vi.fn()} />,
      { client: client() },
    );
    expect(await screen.findByText('There are no units of this type in stock.')).toBeInTheDocument();
  });
});

describe('DetachComponentModal', () => {
  const charm = (): ItemComponent => ({
    id: 40, kind: 'CHARM', catalogId: 'c-1', name: 'Charm | Lil Cap', localizedName: null, imageUrl: null, slot: null, wear: null, pattern: 321,
    source: 'MANUAL', origin: 'APPLIED_FROM_STOCK', sourceItemId: 9, operationId: 3, undoable: true, scrapeable: false, detachable: true,
  } as ItemComponent);

  test('modo SPLIT sem sugestão: a porcentagem é obrigatória e o envio sem ela mostra o erro no campo', async () => {
    api.getDetachPreview.mockResolvedValue({
      mode: 'SPLIT', component: { id: 40, kind: 'CHARM', catalogId: 'c-1', name: 'Charm | Lil Cap', slot: null, pattern: 321, source: 'MANUAL', origin: 'CAME_WITH' },
      weapon: { effectiveUsdCents: 1000, estimated: false }, suggestion: null, suggestionUnavailableReason: 'NOT_FETCHED', valuedTotalUsdCents: null,
      result: null, detached: { category: 'PINGENTE', name: 'Charm | Lil Cap', catalogId: 'c-1' },
    });
    renderUi(
      <DetachComponentModal item={makeItem({ id: 5, components: [charm()] })} onClose={vi.fn()} onDone={vi.fn()} onGone={vi.fn()} />,
      { client: client() },
    );
    const share = await screen.findByLabelText(/Share of the cost/i);
    expect(share).toBeRequired();
    await userEvent.click(screen.getByRole('button', { name: 'Separate' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(api.detachComponent).not.toHaveBeenCalled();
  });

  test('modo RETURN: explica e separa sem pedir porcentagem', async () => {
    api.getDetachPreview.mockResolvedValue({
      mode: 'RETURN', component: { id: 40, kind: 'CHARM', catalogId: 'c-1', name: 'Charm | Lil Cap', slot: null, pattern: 321, source: 'MANUAL', origin: 'APPLIED_FROM_STOCK' },
      weapon: { effectiveUsdCents: 1000, estimated: false }, suggestion: null, suggestionUnavailableReason: null, valuedTotalUsdCents: null,
      result: { weaponUsdCents: 900, detachedUsdCents: 100 }, detached: { category: 'PINGENTE', name: 'Charm | Lil Cap', catalogId: 'c-1', returnedItemId: 9 },
    });
    api.detachComponent.mockResolvedValue({});
    const onDone = vi.fn();
    renderUi(
      <DetachComponentModal item={makeItem({ id: 5, components: [charm()] })} onClose={vi.fn()} onDone={onDone} onGone={vi.fn()} />,
      { client: client() },
    );
    const submit = await screen.findByRole('button', { name: 'Separate' });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);
    await waitFor(() => expect(api.detachComponent).toHaveBeenCalledTimes(1));
    expect(api.detachComponent.mock.calls[0][0]).toBe(5);
    expect(api.detachComponent.mock.calls[0][1]).toBe(40);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});

describe('ItemHistoryBox', () => {
  const stats = { unitCount: 3, consumedCount: 0, lossCount: 0, lossUsdCents: 0, soldWithFxCount: 0, soldCount: 2, soldOffSaleCount: 0, avgDaysToSell: 6, avgPurchaseCostUsdCents: 900, avgSalePriceUsdCents: 1200, avgProfitUsdCents: 300 };

  test('com vendas: mostra as métricas e a legenda visível do tempo até vender', () => {
    renderUi(<ItemHistoryBox stats={stats} />);
    expect(screen.getByText('Units sold')).toBeInTheDocument();
    expect(screen.getByText(/Counted from the end of the trade lock, or from the return to sale, until the sale/)).toBeInTheDocument();
  });

  test('sem vendas ou no modo compacto: sem legenda', () => {
    const { unmount } = renderUi(<ItemHistoryBox stats={{ ...stats, soldCount: 0 }} />);
    expect(screen.queryByText(/Counted from the end/)).not.toBeInTheDocument();
    unmount();
    renderUi(<ItemHistoryBox stats={stats} compact />);
    expect(screen.queryByText(/Counted from the end/)).not.toBeInTheDocument();
  });
});
