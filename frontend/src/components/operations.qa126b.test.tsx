// @vitest-environment jsdom
import '@/test/setupDom';
import { useState } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeItem, STORES } from '@/lib/testFixtures';
import { ApiRequestError } from '@/services/api';
import { renderUi } from '@/test/renderUi';
import type { ItemComponent, OpenOptions } from '@/types/api';

const api = vi.hoisted(() => ({
  getOpenOptions: vi.fn(),
  openContainer: vi.fn(),
  getCatalogStatus: vi.fn(),
  searchCatalog: vi.fn(),
  getApplyCandidates: vi.fn(),
  applyComponent: vi.fn(),
  getItem: vi.fn(),
  resolveImportEntry: vi.fn(),
  getDetachPreview: vi.fn(),
  detachComponent: vi.fn(),
}));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));
vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => ({ usdBrlRate: 5, fxRates: [{ currency: 'BRL', rate: 5 }] }) }));

import ApplyComponentModal from './ApplyComponentModal';
import DetachComponentModal from './DetachComponentModal';
import OpenContainerModal from './OpenContainerModal';

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const key = (id: number, extra = {}) => ({
  itemId: id, name: 'Revolution Case Key', localizedName: null, acquiredAt: '2026-11-0' + id + 'T12:00:00.000Z',
  effectiveCostUsdCents: 200 + id, costEstimated: false, tradeLocked: false, offSale: false, ...extra,
});
const options = (extra: Partial<OpenOptions> = {}): OpenOptions => ({
  kind: 'CASE', containerName: 'Revolution Case', requiredKeyName: 'Revolution Case Key', keys: [key(1)], otherKeysInStock: 0, steamStore: null, defaultFxRate: null, ...extra,
});
const container = (kind: 'CASE' | 'TERMINAL') => makeItem({
  id: 10, name: kind === 'CASE' ? 'Revolution Case' : 'Terminal', category: 'CAIXA',
  openable: { kind, compatibleKeys: 1, otherKeysInStock: 0, otherKeyNames: [], requiredKeyName: 'Revolution Case Key' },
});

function renderOpen(kind: 'CASE' | 'TERMINAL', extra: Partial<OpenOptions> = {}) {
  api.getOpenOptions.mockResolvedValue(options({ kind, ...extra }));
  const handlers = { onClose: vi.fn(), onDone: vi.fn(), onGone: vi.fn(), onRegisterKey: vi.fn() };
  renderUi(<OpenContainerModal item={container(kind)} stores={STORES} {...handlers} />, { client: client() });
  return handlers;
}

// Item obtido em nome livre (OUTRO).
async function fillFreeGenerated() {
  await userEvent.click(await screen.findByRole('button', { name: 'Item not in the catalog' }));
  await userEvent.type(screen.getByLabelText('Name'), 'Dummy');
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getCatalogStatus.mockResolvedValue({ countsBySource: { PATCHES: 0 } });
  api.searchCatalog.mockResolvedValue({ items: [], meta: { catalogUpdatedAt: null, total: 0 } });
});
afterEach(cleanup);

describe('OpenContainerModal: caixa', () => {
  test('uma chave só: aparece como texto (sem seletor); sem escolher o item obtido, o erro aparece e nada é enviado', async () => {
    renderOpen('CASE');
    expect(await screen.findByText(/Revolution Case Key · Cost \$2\.01/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Key')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick the item obtained from the catalog.');
    expect(api.openContainer).not.toHaveBeenCalled();
  });

  test('várias chaves: a mais antiga vem escolhida e marcada; trocar a chave muda o corpo enviado', async () => {
    api.openContainer.mockResolvedValue({ operation: {}, generatedItem: makeItem({ id: 77, name: 'Dummy' }), consumedItemIds: [10, 2] });
    const { onDone } = renderOpen('CASE', { keys: [key(1), key(2, { tradeLocked: true })] });
    const select = (await screen.findByLabelText('Key')) as HTMLSelectElement;
    expect(select).toHaveValue('1');
    expect(select.options[0].textContent).toMatch(/oldest/);
    expect(select.options[1].textContent).toMatch(/in trade lock/);
    await userEvent.selectOptions(select, '2');
    await fillFreeGenerated();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(api.openContainer).toHaveBeenCalledTimes(1));
    expect(api.openContainer.mock.calls[0][0]).toBe(10);
    expect(api.openContainer.mock.calls[0][1]).toMatchObject({ keyItemId: 2, generated: { name: 'Dummy' } });
    expect(api.openContainer.mock.calls[0][1].generated).not.toHaveProperty('purchasePriceCents');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.stringContaining('was opened')));
  });

  test('erro ITEM_NOT_FOUND chama onGone', async () => {
    api.openContainer.mockRejectedValue(new ApiRequestError('ITEM_NOT_FOUND', 'sumiu', 404));
    const { onGone } = renderOpen('CASE');
    await fillFreeGenerated();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(onGone).toHaveBeenCalledTimes(1));
  });

  test('erro de outro campo do item obtido vai para o topo, sem fechar', async () => {
    api.openContainer.mockRejectedValue(new ApiRequestError('INTERNAL_ERROR', 'falhou', 500));
    const { onDone } = renderOpen('CASE');
    await fillFreeGenerated();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();
  });
});

describe('OpenContainerModal: terminal', () => {
  test('sem escolher, o envio fica desabilitado; "Comprar" sem loja Steam mantém desabilitado', async () => {
    renderOpen('TERMINAL', { requiredKeyName: null, keys: [] });
    const buy = await screen.findByRole('radio', { name: 'Buy the item' });
    const submit = screen.getByRole('button', { name: 'Open' });
    expect(submit).toBeDisabled();
    await userEvent.click(buy);
    expect(submit).toBeDisabled();
  });

  test('"Não comprar": pede confirmação aninhada; cancelar mantém o modal; confirmar envia DECLINE sem item obtido', async () => {
    api.openContainer.mockResolvedValue({ operation: {}, generatedItem: null, consumedItemIds: [10] });
    const { onDone } = renderOpen('TERMINAL', { requiredKeyName: null, keys: [] });
    await userEvent.click(await screen.findByRole('radio', { name: /Don't buy/ }));
    expect(screen.queryByText('Item obtained')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Record the loss' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Do not buy the terminal item?')).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(api.openContainer).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Record the loss' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Record the loss' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Do not buy' }));
    await waitFor(() => expect(api.openContainer).toHaveBeenCalledTimes(1));
    const body = api.openContainer.mock.calls[0][1];
    expect(body).toMatchObject({ decision: 'DECLINE' });
    expect(body.generated).toBeUndefined();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.stringContaining('was not bought')));
  });

  test('comprar com loja Steam em BRL: preço, cotação padrão e item obtido vão no corpo', async () => {
    api.openContainer.mockResolvedValue({ operation: {}, generatedItem: makeItem({ id: 77 }), consumedItemIds: [10] });
    renderOpen('TERMINAL', { requiredKeyName: null, keys: [], steamStore: { id: 2, name: 'Steam', currency: 'BRL' }, defaultFxRate: 5 });
    await userEvent.click(await screen.findByRole('radio', { name: 'Buy the item' }));
    await fillFreeGenerated();
    await userEvent.type(screen.getByLabelText(/Price paid \(BRL\)/), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(api.openContainer).toHaveBeenCalledTimes(1));
    expect(api.openContainer.mock.calls[0][1]).toMatchObject({ decision: 'BUY', paidPriceCents: 1000, fxRateAtPurchase: 5, generated: { name: 'Dummy' } });
  });

  test('comprar sem preço: erro no campo e nada enviado', async () => {
    renderOpen('TERMINAL', { requiredKeyName: null, keys: [], steamStore: { id: 2, name: 'Steam', currency: 'BRL' }, defaultFxRate: 5 });
    await userEvent.click(await screen.findByRole('radio', { name: 'Buy the item' }));
    await fillFreeGenerated();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText(/Price paid \(BRL\)/)).toHaveAttribute('aria-invalid', 'true');
    expect(api.openContainer).not.toHaveBeenCalled();
  });

  test('loja Steam em USD: sem campo de cotação', async () => {
    renderOpen('TERMINAL', { requiredKeyName: null, keys: [], steamStore: { id: 9, name: 'Steam US', currency: 'USD' }, defaultFxRate: null });
    await userEvent.click(await screen.findByRole('radio', { name: 'Buy the item' }));
    expect(screen.getByLabelText(/Price paid \(USD\)/)).toBeRequired();
    expect(screen.queryByLabelText(/USD→USD rate/)).not.toBeInTheDocument();
  });
});

describe('ApplyComponentModal: modo retro (Importações)', () => {
  const sticker = () => makeItem({ id: 9, name: 'Sticker | Cool', category: 'STICKER', catalog: null, acquiredAt: '2026-11-01T12:00:00.000Z' });

  test('limita a data à venda da arma, mostra "Apply and record" e resolve a entrada da importação', async () => {
    api.getItem.mockImplementation(async (id: number) => (id === 5 ? makeItem({ id: 5, status: 'VENDIDO', soldAt: '2026-11-18T12:00:00.000Z' }) : sticker()));
    api.resolveImportEntry.mockResolvedValue({});
    const onDone = vi.fn();
    renderUi(
      <ApplyComponentModal target={{ id: 5, name: 'AK-47 | Redline' }} mode={{ type: 'retro', entryId: 31, sourceItemId: 9 }} onClose={vi.fn()} onDone={onDone} onGone={vi.fn()} />,
      { client: client() },
    );
    const submit = await screen.findByRole('button', { name: 'Apply and record' });
    expect(await screen.findByText(/Up to .* \(sale date\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Application date')).toHaveAttribute('max');
    expect(api.getApplyCandidates).not.toHaveBeenCalled();
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);
    await waitFor(() => expect(api.resolveImportEntry).toHaveBeenCalledTimes(1));
    expect(api.resolveImportEntry.mock.calls[0][0]).toBe(31);
    expect(api.resolveImportEntry.mock.calls[0][1]).toMatchObject({ action: 'APPLY_FROM_STOCK', sourceItemId: 9 });
    expect(api.applyComponent).not.toHaveBeenCalled();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  test('a unidade sugerida já não existe no estoque: aviso e sem envio', async () => {
    api.getItem.mockImplementation(async (id: number) => (id === 5 ? makeItem({ id: 5, status: 'VENDIDO', soldAt: '2026-11-18T12:00:00.000Z' }) : makeItem({ id: 9, category: 'OUTRO' })));
    renderUi(
      <ApplyComponentModal target={{ id: 5, name: 'AK-47 | Redline' }} mode={{ type: 'retro', entryId: 31, sourceItemId: 9 }} onClose={vi.fn()} onDone={vi.fn()} onGone={vi.fn()} />,
      { client: client() },
    );
    expect(await screen.findByText('The suggested unit is no longer available in stock.')).toBeInTheDocument();
    expect(api.resolveImportEntry).not.toHaveBeenCalled();
  });

  test('ITEM_NOT_FOUND ao aplicar chama onGone', async () => {
    api.getApplyCandidates.mockResolvedValue({
      allowedKinds: ['STICKER'], remaining: { stickers: 5, hanging: 1, patches: 3 },
      candidates: [{ itemId: 1, kind: 'STICKER', catalogId: 's1', name: 'Sticker | A', localizedName: null, imageUrl: null, acquiredAt: '2026-11-01T12:00:00.000Z', effectiveCostUsdCents: 100, costEstimated: false, tradeLocked: false, offSale: false }],
    });
    api.applyComponent.mockRejectedValue(new ApiRequestError('ITEM_NOT_FOUND', 'sumiu', 404));
    const onGone = vi.fn();
    renderUi(<ApplyComponentModal target={{ id: 5, name: 'AK' }} mode={{ type: 'stock' }} onClose={vi.fn()} onDone={vi.fn()} onGone={onGone} />, { client: client() });
    await userEvent.click(await screen.findByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onGone).toHaveBeenCalledTimes(1));
  });
});

describe('DetachComponentModal: corpo enviado', () => {
  const charm = (): ItemComponent => ({
    id: 40, kind: 'CHARM', catalogId: 'c-1', name: 'Charm | Lil Cap', localizedName: null, imageUrl: null, slot: null, wear: null, pattern: 321,
    source: 'MANUAL', origin: 'CAME_WITH', sourceItemId: null, operationId: null, undoable: false, scrapeable: false, detachable: true,
  } as ItemComponent);
  const splitPreview = {
    mode: 'SPLIT', component: { id: 40, kind: 'CHARM', catalogId: 'c-1', name: 'Charm | Lil Cap', slot: null, pattern: 321, source: 'MANUAL', origin: 'CAME_WITH' },
    weapon: { effectiveUsdCents: 1000, estimated: false }, suggestion: null, suggestionUnavailableReason: 'NOT_FETCHED', valuedTotalUsdCents: null,
    result: { weaponUsdCents: 600, detachedUsdCents: 400 }, detached: { category: 'PINGENTE', name: 'Charm | Lil Cap', catalogId: 'c-1' },
  };

  test('SPLIT com a porcentagem digitada: envia hangingShareBp em pontos-base', async () => {
    api.getDetachPreview.mockResolvedValue(splitPreview);
    api.detachComponent.mockResolvedValue({});
    const onDone = vi.fn();
    renderUi(<DetachComponentModal item={makeItem({ id: 5, components: [charm()] })} onClose={vi.fn()} onDone={onDone} onGone={vi.fn()} />, { client: client() });
    await userEvent.type(await screen.findByLabelText(/Share of the cost/i), '40');
    await waitFor(() => expect(api.getDetachPreview).toHaveBeenCalledWith(5, 40, 4000, expect.anything()));
    const submit = screen.getByRole('button', { name: 'Separate' });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);
    await waitFor(() => expect(api.detachComponent).toHaveBeenCalledTimes(1));
    expect(api.detachComponent.mock.calls[0][2]).toMatchObject({ hangingShareBp: 4000 });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  test('porcentagem inválida (acima de 100) desabilita o envio', async () => {
    api.getDetachPreview.mockResolvedValue(splitPreview);
    renderUi(<DetachComponentModal item={makeItem({ id: 5, components: [charm()] })} onClose={vi.fn()} onDone={vi.fn()} onGone={vi.fn()} />, { client: client() });
    await userEvent.type(await screen.findByLabelText(/Share of the cost/i), '150');
    expect(screen.getByRole('button', { name: 'Separate' })).toBeDisabled();
  });
});

describe('foco devolvido a quem abriu (D118)', () => {
  test('Abrir: cancelar devolve o foco ao botão da linha', async () => {
    api.getOpenOptions.mockResolvedValue(options());
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Abrir linha</button>
          {open && <OpenContainerModal item={container('CASE')} stores={STORES} onClose={() => setOpen(false)} onDone={vi.fn()} onGone={vi.fn()} onRegisterKey={vi.fn()} />}
        </>
      );
    }
    renderUi(<Harness />, { client: client() });
    const trigger = screen.getByRole('button', { name: 'Abrir linha' });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  test('Aplicar: cancelar devolve o foco', async () => {
    api.getApplyCandidates.mockResolvedValue({ allowedKinds: [], remaining: { stickers: 5, hanging: 1, patches: 3 }, candidates: [] });
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Aplicar linha</button>
          {open && <ApplyComponentModal target={{ id: 5, name: 'AK' }} mode={{ type: 'stock' }} onClose={() => setOpen(false)} onDone={vi.fn()} onGone={vi.fn()} />}
        </>
      );
    }
    renderUi(<Harness />, { client: client() });
    const trigger = screen.getByRole('button', { name: 'Aplicar linha' });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
