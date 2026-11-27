// @vitest-environment jsdom
// QA da 12.6a: lacunas do ItemFormModal (datas, +7 dias, KRW, erros do servidor, Combobox do catálogo, painel de componentes).
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeItem, makeStore, STORES } from '@/lib/testFixtures';
import { ApiRequestError } from '@/services/api';
import { renderUi } from '@/test/renderUi';
import type { CatalogItem, ItemComponent } from '@/types/api';

const api = vi.hoisted(() => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
  getCatalogStatus: vi.fn(),
  searchCatalog: vi.fn(),
  refreshCatalog: vi.fn(),
  listItemOperations: vi.fn(),
  undoOperation: vi.fn(),
  scrapeOffComponent: vi.fn(),
}));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));
vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => ({ usdBrlRate: 5, fxRates: [{ currency: 'BRL', rate: 5 }] }) }));

import ItemFormModal from './ItemFormModal';

const STORE_LIST = [...STORES, makeStore({ id: 5, name: 'Japan shop', currency: 'JPY' }), makeStore({ id: 6, name: 'Korea shop', currency: 'KRW' })];
const UPDATE_CATALOG = "Can't find it? Update the catalog";
const result = (items: CatalogItem[]) => ({ items, meta: { catalogUpdatedAt: null, total: items.length } });
const catalogItem = (extra: Partial<CatalogItem> = {}): CatalogItem => ({
  id: 'skin-ak-redline', source: 'SKINS', category: 'SKIN', name: 'AK-47 | Redline', localizedName: null, imageUrl: null, minFloat: 0.1,
  maxFloat: 0.7, hasStattrak: true, hasSouvenir: false, phase: null, rarity: null, ...extra,
});
const component = (extra: Partial<ItemComponent> = {}): ItemComponent => ({
  id: 77, kind: 'STICKER', catalogId: 'sticker-1', name: 'Sticker | Cool', localizedName: null, imageUrl: null, slot: 0, wear: null, pattern: null,
  source: 'MANUAL', origin: 'APPLIED_FROM_STOCK', sourceItemId: 99, operationId: 5, undoable: true, scrapeable: true, detachable: false, ...extra,
} as ItemComponent);

function renderForm(props: Partial<React.ComponentProps<typeof ItemFormModal>> = {}) {
  const handlers = { onClose: vi.fn(), onSaved: vi.fn(), onGone: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderUi(<ItemFormModal stores={STORE_LIST} {...handlers} {...props} />, { client });
  return handlers;
}

async function fillFreeItem(price = '1.00') {
  await userEvent.click(screen.getByRole('button', { name: 'Item not in the catalog' }));
  await userEvent.type(screen.getByLabelText('Name'), 'Dummy');
  await userEvent.type(screen.getByLabelText(/Purchase price/), price);
}

const wonItem = () => makeItem({ acquisitionType: 'GANHEI', purchaseStoreId: 1, purchasePriceCents: 0, fxRateAtPurchase: null });

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getCatalogStatus.mockResolvedValue({ countsBySource: { PATCHES: 0 } });
  api.listItemOperations.mockResolvedValue([]);
  api.searchCatalog.mockResolvedValue(result([]));
});
afterEach(cleanup);

describe('Compra: corpo enviado, moedas sem casas e datas', () => {
  test('Compra envia preço em centavos, loja e data/trade lock em ISO', async () => {
    api.createItem.mockResolvedValue(makeItem());
    renderForm();
    await fillFreeItem('12.34');
    fireEvent.change(screen.getByLabelText('Purchase date'), { target: { value: '2026-11-01T10:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createItem).toHaveBeenCalledTimes(1));
    const body = api.createItem.mock.calls[0][0];
    expect(body).toMatchObject({ acquisitionType: 'COMPRA', purchasePriceCents: 1234, purchaseStoreId: 1 });
    expect(new Date(body.acquiredAt).getTime()).toBe(new Date('2026-11-01T10:00').getTime());
    expect(new Date(body.tradeUnlockAt).getTime()).toBe(new Date('2026-11-08T10:00').getTime());
  });

  test('JPY: 1500 ienes vão como 150000 (unidade interna x100 do app, D369 A3)', async () => {
    api.createItem.mockResolvedValue(makeItem());
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Item not in the catalog' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Dummy');
    await userEvent.selectOptions(screen.getByLabelText(/Purchase store/), '5');
    await userEvent.type(screen.getByLabelText(/Purchase price \(JPY\)/), '1500');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createItem).toHaveBeenCalledTimes(1));
    expect(api.createItem.mock.calls[0][0]).toMatchObject({ purchaseStoreId: 5, purchasePriceCents: 150000 });
  });

  test('KRW: "1.5" mostra o erro de moeda sem centavos e nada é enviado', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Item not in the catalog' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Dummy');
    await userEvent.selectOptions(screen.getByLabelText(/Purchase store/), '6');
    await userEvent.type(screen.getByLabelText(/Purchase price \(KRW\)/), '1.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findAllByText(/no decimal places/)).length).toBeGreaterThan(0);
    expect(api.createItem).not.toHaveBeenCalled();
  });

  test('"+7 dias" soma 7 dias à data de compra', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Purchase date'), { target: { value: '2026-11-10T08:30' } });
    fireEvent.change(screen.getByLabelText('Trade lock end'), { target: { value: '' } });
    await userEvent.click(screen.getByRole('button', { name: '+7 days' }));
    expect(screen.getByLabelText('Trade lock end')).toHaveValue('2026-11-17T08:30');
  });

  test('fim do trade lock antes da compra: o formulário não bloqueia e envia as duas datas (regra de datas é do backend)', async () => {
    api.createItem.mockResolvedValue(makeItem());
    renderForm();
    await fillFreeItem();
    fireEvent.change(screen.getByLabelText('Purchase date'), { target: { value: '2026-11-10T08:30' } });
    fireEvent.change(screen.getByLabelText('Trade lock end'), { target: { value: '2026-11-01T08:30' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createItem).toHaveBeenCalledTimes(1));
    const body = api.createItem.mock.calls[0][0];
    expect(new Date(body.tradeUnlockAt).getTime()).toBeLessThan(new Date(body.acquiredAt).getTime());
  });

  test('data de compra no futuro (ACQUIRED_AT_IN_FUTURE do servidor) aparece traduzida no campo da data', async () => {
    api.createItem.mockRejectedValue(new ApiRequestError('ACQUIRED_AT_IN_FUTURE', 'x', 400, {}));
    renderForm();
    await fillFreeItem();
    fireEvent.change(screen.getByLabelText('Purchase date'), { target: { value: '2099-01-01T10:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const field = await screen.findByLabelText('Purchase date');
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getAllByText('The purchase date cannot be in the future.').length).toBeGreaterThan(0);
    expect(screen.getByRole('alert')).toHaveTextContent('Check 1 field');
  });

  test('erro do servidor com field tradeUnlockAt cai no campo do trade lock', async () => {
    api.createItem.mockRejectedValue(new ApiRequestError('VALIDATION_ERROR', 'x', 400, { field: 'tradeUnlockAt' }));
    renderForm();
    await fillFreeItem();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByLabelText('Trade lock end')).toHaveAttribute('aria-invalid', 'true'));
  });

  test('erro de campo que o formulário não tem vai para o topo, sem marcar outro campo', async () => {
    api.createItem.mockRejectedValue(new ApiRequestError('VALIDATION_ERROR', 'x', 400, { field: 'campoInexistente' }));
    renderForm();
    await fillFreeItem();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createItem).toHaveBeenCalled());
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/Purchase price/)).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('Ganhei: voltar para Compra traz de volta preço e rótulo da data', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('radio', { name: 'Received' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Purchase' }));
    expect(screen.getByLabelText(/Purchase price/)).toBeInTheDocument();
    expect(screen.getByLabelText('Purchase date')).toBeInTheDocument();
  });

  test('edição de item ganho que passa para Compra envia a loja gravada e o preço', async () => {
    api.updateItem.mockResolvedValue(makeItem());
    renderForm({ item: wonItem() });
    await userEvent.click(screen.getByRole('radio', { name: 'Purchase' }));
    await userEvent.type(screen.getByLabelText(/Purchase price/), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(1));
    expect(api.updateItem.mock.calls[0][1]).toMatchObject({ acquisitionType: 'COMPRA', purchasePriceCents: 300, purchaseStoreId: 1 });
  });

  test('edição do item ganho sem mexer na loja informativa não envia loja nem preço', async () => {
    api.updateItem.mockResolvedValue(makeItem());
    renderForm({ item: wonItem() });
    await userEvent.type(screen.getByLabelText('Float'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(1));
    expect(api.updateItem.mock.calls[0][1]).not.toHaveProperty('purchaseStoreId');
    expect(api.updateItem.mock.calls[0][1]).not.toHaveProperty('purchasePriceCents');
  });
});

describe('resumo de erros: foco e revealFor', () => {
  test('erro da loja informativa no item ganho abre "Mais detalhes"', async () => {
    api.updateItem.mockRejectedValue(new ApiRequestError('VALIDATION_ERROR', 'x', 400, { field: 'purchaseStoreId' }));
    renderForm({ item: wonItem() });
    await userEvent.type(screen.getByLabelText('Float'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const select = await screen.findByLabelText(/Store \(informative only\)/);
    await waitFor(() => expect(select).toHaveAttribute('aria-invalid', 'true'));
  });

  test('um segundo envio com erro novo traz o foco de volta ao resumo', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const summary = await screen.findByRole('alert');
    await waitFor(() => expect(summary).toHaveFocus());
    await userEvent.click(screen.getByLabelText('Catalog item'));
    expect(summary).not.toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  });
});

describe('CatalogCombobox', () => {
  test('a busca só dispara depois da pausa e uma vez só para uma digitação rápida', async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText('Catalog item'), 'redline', { delay: 5 });
    expect(api.searchCatalog).not.toHaveBeenCalled();
    await waitFor(() => expect(api.searchCatalog).toHaveBeenCalledTimes(1));
    expect(api.searchCatalog.mock.calls[0][0]).toBe('redline');
  });

  test('digitar de novo cancela a busca anterior (AbortSignal)', async () => {
    let firstSignal: AbortSignal | undefined;
    api.searchCatalog
      .mockImplementationOnce((_q: string, opts: { signal: AbortSignal }) => {
        firstSignal = opts.signal;
        return new Promise(() => undefined);
      })
      .mockResolvedValue(result([catalogItem()]));
    renderForm();
    const input = screen.getByLabelText('Catalog item');
    await userEvent.type(input, 'ak');
    await waitFor(() => expect(api.searchCatalog).toHaveBeenCalledTimes(1));
    await userEvent.type(input, 'x');
    expect(firstSignal?.aborted).toBe(true);
  });

  test('texto curto não busca', async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText('Catalog item'), 'a');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(api.searchCatalog).not.toHaveBeenCalled();
  });

  test('o filtro de categoria vai na busca', async () => {
    renderForm();
    await userEvent.selectOptions(screen.getByLabelText('Filter by category'), 'STICKER');
    await userEvent.type(screen.getByLabelText('Catalog item'), 'cool');
    await waitFor(() => expect(api.searchCatalog).toHaveBeenCalled());
    expect(api.searchCatalog.mock.calls.at(-1)?.[1]).toMatchObject({ category: 'STICKER' });
  });

  test('sem resultado mostra "No items found." e o botão de atualizar o catálogo', async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText('Catalog item'), 'zzzz');
    expect(await screen.findByText('No items found.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: UPDATE_CATALOG })).toBeInTheDocument();
  });

  test('"Atualizar o catálogo" chama a API, avisa a data e repete a busca', async () => {
    api.refreshCatalog.mockResolvedValue({ catalogUpdatedAt: '2026-11-20T12:00:00.000Z' });
    renderForm();
    await userEvent.type(screen.getByLabelText('Catalog item'), 'zzzz');
    await screen.findByText('No items found.');
    expect(api.searchCatalog).toHaveBeenCalledTimes(1);
    await userEvent.click(await screen.findByRole('button', { name: UPDATE_CATALOG }));
    await waitFor(() => expect(api.refreshCatalog).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Catalog updated on /)).toBeInTheDocument();
    await waitFor(() => expect(api.searchCatalog.mock.calls.length).toBe(2), { timeout: 3000 });
  });

  test('falha ao atualizar o catálogo marca o campo com erro', async () => {
    api.refreshCatalog.mockRejectedValue(new ApiRequestError('NETWORK_ERROR', 'x', 0, {}));
    renderForm();
    await userEvent.type(screen.getByLabelText('Catalog item'), 'zzzz');
    await userEvent.click(await screen.findByRole('button', { name: UPDATE_CATALOG }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Catalog item' })).toHaveAttribute('aria-invalid', 'true'));
  });

  test('um erro ABORTED da busca é ignorado', async () => {
    api.searchCatalog.mockRejectedValueOnce(new ApiRequestError('ABORTED', 'x', 0, {}));
    renderForm();
    await userEvent.type(screen.getByLabelText('Catalog item'), 'ak47');
    await waitFor(() => expect(api.searchCatalog).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByRole('combobox', { name: 'Catalog item' })).not.toHaveAttribute('aria-invalid', 'true');
  });
});

describe('ComponentsPanel: limites e bloqueios', () => {
  test('pendurado: um único seletor de tipo, e trocar o tipo troca a busca', async () => {
    renderForm({ item: makeItem() });
    expect(screen.getAllByLabelText('Type')).toHaveLength(1);
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'CHARM');
    expect(screen.getByLabelText(/^Charm \(catalog\)/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'STICKER_SLAB');
    expect(screen.getByLabelText(/Sticker inside the slab/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Type'), '__none__');
    expect(screen.queryByLabelText(/Sticker inside the slab/)).not.toBeInTheDocument();
  });

  test('patch só para agente: arma não tem "Add patch" e agente não tem "Add sticker"', async () => {
    api.getCatalogStatus.mockResolvedValue({ countsBySource: { PATCHES: 10 } });
    renderForm({ item: makeItem() });
    expect(screen.queryByRole('button', { name: 'Add patch' })).not.toBeInTheDocument();
    cleanup();
    renderForm({ item: makeItem({ category: 'PERSONAGEM', catalogId: null, catalog: null }) });
    expect(await screen.findByRole('button', { name: 'Add patch' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add sticker' })).not.toBeInTheDocument();
  });

  test('agente sem patches no catálogo não mostra o painel', async () => {
    renderForm({ item: makeItem({ category: 'PERSONAGEM', catalogId: null, catalog: null }) });
    await waitFor(() => expect(api.getCatalogStatus).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Components' })).not.toBeInTheDocument();
  });

  test('desfazer a alteração libera de novo a ação bloqueada', async () => {
    renderForm({ item: makeItem({ canReceiveComponents: true }), onApply: vi.fn() });
    const float = screen.getByLabelText('Float');
    await userEvent.type(float, '1');
    expect(screen.getByRole('button', { name: 'Apply from stock' })).toBeDisabled();
    await userEvent.type(float, '{Backspace}');
    expect(screen.getByRole('button', { name: 'Apply from stock' })).toBeEnabled();
    expect(screen.queryByText('Save or discard your changes first.')).not.toBeInTheDocument();
  });

  test('Separar fica bloqueado quando se adiciona uma linha de sticker', async () => {
    const onDetach = vi.fn();
    const hanging = component({ id: 88, kind: 'CHARM', origin: 'CAME_WITH', slot: null, detachable: true, operationId: null, undoable: false, scrapeable: false });
    renderForm({ item: makeItem({ components: [hanging] }), onDetach });
    const detach = screen.getAllByRole('button', { name: /Detach|Separate/ });
    expect(detach.length).toBeGreaterThan(0);
    expect(screen.queryByText('Save or discard your changes first.')).not.toBeInTheDocument();
    expect(detach[0]).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Add sticker' }));
    expect(screen.getAllByRole('button', { name: /Detach|Separate/ })[0]).toBeDisabled();
  });
});

describe('unidade gerada: corpo da edição', () => {
  test('editar só o float de uma unidade gerada não envia tipo, loja nem data', async () => {
    api.updateItem.mockResolvedValue(makeItem());
    const generated = makeItem({ acquisitionType: 'COMPRA', generatedFrom: { kind: 'CASE', containerName: 'Box' } as never });
    renderForm({ item: generated });
    await userEvent.type(screen.getByLabelText('Float'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(1));
    const body = api.updateItem.mock.calls[0][1];
    expect(body).not.toHaveProperty('acquisitionType');
    expect(body).not.toHaveProperty('purchaseStoreId');
    expect(body).not.toHaveProperty('acquiredAt');
  });
});
