// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeItem, makeStore, STORES } from '@/lib/testFixtures';
import { ApiRequestError } from '@/services/api';
import { renderUi } from '@/test/renderUi';
import type { CatalogItem, ItemComponent, ItemView } from '@/types/api';

const api = vi.hoisted(() => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
  getCatalogStatus: vi.fn(),
  searchCatalog: vi.fn(),
  listItemOperations: vi.fn(),
  undoOperation: vi.fn(),
  scrapeOffComponent: vi.fn(),
}));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));
vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => ({ usdBrlRate: 5, fxRates: [{ currency: 'BRL', rate: 5 }] }) }));

import ItemFormModal from './ItemFormModal';

const JPY_STORE = makeStore({ id: 5, name: 'Japan shop', currency: 'JPY' });
const STORE_LIST = [...STORES, JPY_STORE];

const catalogItem = (extra: Partial<CatalogItem> = {}): CatalogItem => ({
  id: 'skin-ak-redline', source: 'SKINS', category: 'SKIN', name: 'AK-47 | Redline', localizedName: null, imageUrl: null, minFloat: 0.1,
  maxFloat: 0.7, hasStattrak: true, hasSouvenir: false, phase: null, rarity: null, ...extra,
});

const sticker = (extra: Partial<ItemComponent> = {}): ItemComponent => ({
  id: 77, kind: 'STICKER', catalogId: 'sticker-1', name: 'Sticker | Cool', localizedName: null, imageUrl: null, slot: 0, wear: null, pattern: null,
  source: 'MANUAL', origin: 'APPLIED_FROM_STOCK', sourceItemId: 99, operationId: 5, undoable: true, scrapeable: true, detachable: false, ...extra,
} as ItemComponent);

function renderForm(props: Partial<React.ComponentProps<typeof ItemFormModal>> = {}) {
  const handlers = { onClose: vi.fn(), onSaved: vi.fn(), onGone: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderUi(<ItemFormModal stores={STORE_LIST} {...handlers} {...props} />, { client });
  return handlers;
}

// Cadastro mínimo válido em nome livre (OUTRO), na loja primária (USD).
async function fillFreeItem(price = '1.00') {
  await userEvent.click(screen.getByRole('button', { name: 'Item not in the catalog' }));
  await userEvent.type(screen.getByLabelText('Name'), 'Dummy');
  await userEvent.type(screen.getByLabelText(/Purchase price/), price);
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getCatalogStatus.mockResolvedValue({ countsBySource: { PATCHES: 0 } });
  api.listItemOperations.mockResolvedValue([]);
  api.searchCatalog.mockResolvedValue({ items: [], meta: { catalogUpdatedAt: null, total: 0 } });
});
afterEach(cleanup);

describe('Compra e Ganhei', () => {
  test('Compra mostra preço e datas de compra; Ganhei esconde preço e cotação e troca o rótulo da data', async () => {
    renderForm();
    // loja Steam (BRL) mostra a cotação; a primária (USD) não
    await userEvent.selectOptions(screen.getByLabelText(/Purchase store/), '2');
    expect(screen.getByLabelText(/USD→BRL rate/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Purchase price \(BRL\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Purchase date')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Received' }));
    expect(screen.queryByLabelText(/Purchase price/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/USD→BRL rate/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Purchase date')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Date you received it')).toBeInTheDocument();
    expect(screen.getByText('Received items always cost US$ 0.00')).toBeInTheDocument();
    // a loja informativa saiu do corpo principal e vai para "Mais detalhes"
    expect(screen.queryByLabelText(/Purchase store/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More details' }));
    expect(screen.getByLabelText(/Store \(informative only\)/)).toBeInTheDocument();
  });

  test('o corpo do cadastro de um item ganho não leva preço nem cotação', async () => {
    api.createItem.mockResolvedValue(makeItem());
    const { onSaved } = renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Item not in the catalog' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Dummy');
    await userEvent.click(screen.getByRole('radio', { name: 'Received' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createItem).toHaveBeenCalledTimes(1));
    const body = api.createItem.mock.calls[0][0];
    expect(body).toMatchObject({ acquisitionType: 'GANHEI', category: 'OUTRO', name: 'Dummy' });
    expect(body).not.toHaveProperty('purchasePriceCents');
    expect(body).not.toHaveProperty('fxRateAtPurchase');
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Item created.'));
  });

  test('JPY: "15.5" mostra o erro da moeda sem centavos depois do blur', async () => {
    renderForm();
    await userEvent.selectOptions(screen.getByLabelText(/Purchase store/), '5');
    const price = screen.getByLabelText(/Purchase price \(JPY\)/);
    await userEvent.type(price, '15.5');
    expect(screen.queryByText(/no decimal places/)).not.toBeInTheDocument();
    await userEvent.tab();
    expect(await screen.findByText(/no decimal places/)).toBeInTheDocument();
  });

  test('item ganho na edição: a loja gravada continua em "Mais detalhes" e a data usa o rótulo novo', async () => {
    renderForm({ item: makeItem({ acquisitionType: 'GANHEI', purchaseStoreId: 1, purchasePriceCents: 0, fxRateAtPurchase: null }) });
    expect(screen.getByLabelText('Date you received it')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More details' }));
    expect(screen.getByLabelText(/Store \(informative only\)/)).toHaveValue('1');
  });
});

describe('unidade gerada por uma operação', () => {
  test('tipo, loja e data ficam só para leitura, com a ajuda "desfaça a operação"', async () => {
    const generated = makeItem({ acquisitionType: 'COMPRA', generatedFrom: { kind: 'CASE', containerName: 'Box' } as unknown as ItemView['generatedFrom'] });
    renderForm({ item: generated });
    expect(screen.getByLabelText('Purchase date')).toBeDisabled();
    expect(screen.getByLabelText(/Purchase store/, { selector: 'select' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Purchase' })).toBeDisabled();
    await userEvent.click(screen.getAllByRole('button', { name: /^Help:/ })[0]);
    expect(await screen.findByText(/Undo the operation to change this field/)).toBeInTheDocument();
  });
});

describe('resumo de erros', () => {
  test('enviar sem escolher o item mostra o resumo com foco e o item do resumo foca o campo', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('Check 1 field');
    await waitFor(() => expect(summary).toHaveFocus());
    await userEvent.click(within(summary).getByRole('button', { name: /Catalog item/ }));
    expect(screen.getByLabelText('Catalog item')).toHaveFocus();
    expect(api.createItem).not.toHaveBeenCalled();
  });

  test('erro de campo dentro de "Mais detalhes" abre o bloco e marca o campo', async () => {
    api.createItem.mockRejectedValue(new ApiRequestError('INVALID_FIELD', 'x', 400, { field: 'assetId' }));
    renderForm();
    await fillFreeItem();
    expect(screen.queryByLabelText(/Asset ID/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const field = await screen.findByLabelText(/Asset ID/);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    const summary = await screen.findByRole('alert');
    await userEvent.click(within(summary).getByRole('button', { name: /Asset ID/ }));
    expect(field).toHaveFocus();
  });

  test('CATALOG_ITEM_REQUIRED volta para a busca do catálogo com o erro junto do campo', async () => {
    api.createItem.mockRejectedValue(new ApiRequestError('CATALOG_ITEM_REQUIRED', 'x', 400, {}));
    renderForm();
    await fillFreeItem();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const search = await screen.findByLabelText('Catalog item');
    await waitFor(() => expect(search).toHaveAttribute('aria-invalid', 'true'));
  });

  test('corrigir um campo tira o erro dele sem roubar o foco de quem digita', async () => {
    renderForm();
    await fillFreeItem('abc');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('Check 1 field');
    const price = screen.getByLabelText(/Purchase price/);
    await userEvent.clear(price);
    await userEvent.type(price, '2');
    expect(price).toHaveFocus();
    await waitFor(() => expect(screen.queryByText('Check 1 field')).not.toBeInTheDocument());
    expect(price).toHaveFocus();
  });
});

describe('busca no catálogo', () => {
  test('escolher um resultado mostra o item e os campos de arma', async () => {
    api.searchCatalog.mockResolvedValue({ items: [catalogItem()], meta: { catalogUpdatedAt: null, total: 1 } });
    renderForm();
    await userEvent.type(screen.getByLabelText('Catalog item'), 'redline');
    await userEvent.click(await screen.findByRole('option', { name: /AK-47 \| Redline/ }));
    expect(await screen.findByRole('button', { name: 'Change item' })).toBeInTheDocument();
    expect(screen.getByLabelText('Float')).toBeInTheDocument();
    expect(screen.getByLabelText('Variant')).toBeInTheDocument();
  });

  test('uma resposta velha nunca sobrescreve a mais nova', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    api.searchCatalog
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => ({ items: [catalogItem({ id: 'new', name: 'Newer result' })], meta: { catalogUpdatedAt: null, total: 1 } }));
    renderForm();
    const input = screen.getByLabelText('Catalog item');
    await userEvent.type(input, 'ak');
    await waitFor(() => expect(api.searchCatalog).toHaveBeenCalledTimes(1));
    await userEvent.type(input, 'x');
    expect(await screen.findByRole('option', { name: /Newer result/ })).toBeInTheDocument();
    resolveFirst({ items: [catalogItem({ id: 'old', name: 'Older result' })], meta: { catalogUpdatedAt: null, total: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('option', { name: /Older result/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Newer result/ })).toBeInTheDocument();
  });
});

describe('painel Componentes', () => {
  test('a edição de uma arma mostra o painel; a categoria sem componentes não', async () => {
    renderForm({ item: makeItem() });
    expect(screen.getByRole('heading', { name: 'Components' })).toBeInTheDocument();
    cleanup();
    renderForm({ item: makeItem({ category: 'CAIXA', catalogId: null, catalog: null, isLegacy: false }) });
    expect(screen.queryByRole('heading', { name: 'Components' })).not.toBeInTheDocument();
  });

  test('com alteração pendente, Aplicar do estoque fica desabilitado com o motivo visível', async () => {
    const onApply = vi.fn();
    renderForm({ item: makeItem({ canReceiveComponents: true }), onApply });
    const apply = screen.getByRole('button', { name: 'Apply from stock' });
    expect(apply).toBeEnabled();
    expect(screen.queryByText('Save or discard your changes first.')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Float'), '1');
    expect(screen.getByRole('button', { name: 'Apply from stock' })).toBeDisabled();
    expect(screen.getByText('Save or discard your changes first.')).toBeInTheDocument();
  });

  test('sem alteração, Aplicar do estoque chama o host com o item', async () => {
    const onApply = vi.fn();
    const item = makeItem({ canReceiveComponents: true });
    renderForm({ item, onApply });
    await userEvent.click(screen.getByRole('button', { name: 'Apply from stock' }));
    expect(onApply).toHaveBeenCalledWith(item);
  });

  test('os aplicados do estoque mostram a origem com a data e o desfazer fica desabilitado se há alteração', async () => {
    api.listItemOperations.mockResolvedValue([{ id: 5, kind: 'APPLY_COMPONENT', occurredAt: '2026-11-10T12:00:00.000Z', counterparts: [], undoable: true, undoneAt: null }]);
    renderForm({ item: makeItem({ components: [sticker()] }) });
    expect(await screen.findByText(/Applied from stock on /)).toBeInTheDocument();
    const undo = screen.getAllByRole('button', { name: 'Undo application' })[0];
    expect(undo).toBeEnabled();
    await userEvent.type(screen.getByLabelText('Float'), '1');
    expect(screen.getAllByRole('button', { name: 'Undo application' })[0]).toBeDisabled();
  });

  test('limite de 5 stickers: o botão de adicionar desabilita e o limite aparece', async () => {
    renderForm({ item: makeItem() });
    for (let i = 0; i < 5; i += 1) await userEvent.click(screen.getByRole('button', { name: 'Add sticker' }));
    expect(screen.getByRole('button', { name: 'Add sticker' })).toBeDisabled();
    expect(screen.getByText('Maximum of 5 stickers.')).toBeInTheDocument();
  });

  test('limite de 3 patches no agente', async () => {
    api.getCatalogStatus.mockResolvedValue({ countsBySource: { PATCHES: 10 } });
    renderForm({ item: makeItem({ category: 'PERSONAGEM', catalogId: null, catalog: null }) });
    for (let i = 0; i < 3; i += 1) await userEvent.click(await screen.findByRole('button', { name: 'Add patch' }));
    expect(screen.getByRole('button', { name: 'Add patch' })).toBeDisabled();
  });

  test('a entrada "Componentes" do menu abre a edição com o foco no painel', async () => {
    renderForm({ item: makeItem(), focusComponents: true });
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-field', 'components'));
  });

  test('sem a entrada do menu, o foco inicial é o primeiro campo, não o painel', async () => {
    renderForm({ item: makeItem() });
    await waitFor(() => expect(document.activeElement).not.toHaveAttribute('data-field', 'components'));
  });
});

describe('fechar', () => {
  test('Cancelar chama onClose e nada é enviado', async () => {
    const { onClose } = renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(api.createItem).not.toHaveBeenCalled();
  });

  test('edição sem alteração fecha sem chamar a API', async () => {
    const { onClose } = renderForm({ item: makeItem() });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClose).toHaveBeenCalled();
    expect(api.updateItem).not.toHaveBeenCalled();
  });
});
