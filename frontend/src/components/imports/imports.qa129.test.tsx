// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { renderUi } from '@/test/renderUi';
import type { ImportBatchView, ImportEntryView, IntegrationView, Store, UndoPreview } from '@/types/api';

const api = vi.hoisted(() => ({
  listStores: vi.fn(),
  getCsfloatIntegration: vi.fn(),
  getSettings: vi.fn(),
  resolveImportEntry: vi.fn(),
  reopenImportEntry: vi.fn(),
  bulkResolveImportEntries: vi.fn(),
  previewCutoffChange: vi.fn(),
  getUndoPreview: vi.fn(),
  undoImportBatch: vi.fn(),
}));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));

import ImportEntriesList from '../ImportEntriesList';

const INTEGRATION: IntegrationView = {
  source: 'CSFLOAT', storeId: 1, storeName: 'CSFloat', storeCurrency: 'USD', storeSaleFeeRate: 0.02, storeWithdrawalFeeRate: 0.025,
  hasApiKey: true, apiKeyMasked: '****a1b2', apiKeySavedAt: '2026-11-20T10:00:00.000Z', accountLinked: true, autoImportOnOpen: false, autoImportPaused: false,
  tradesCutoffAt: '2026-11-01T00:00:00.000Z', lastImportAt: null, lastImportStatus: null, lastImportErrorCode: null,
  importInProgress: false, openEntriesCount: 0, suggestedCutoffAt: null, helpUrl: 'https://csfloat.com/profile',
};

const STORES = [
  { id: 1, name: 'CSFloat', currency: 'USD', isActive: true },
  { id: 2, name: 'Mercari JP', currency: 'JPY', isActive: true },
  { id: 3, name: 'Velha', currency: 'USD', isActive: false },
] as unknown as Store[];

function entry(id: number, outcome: ImportEntryView['outcome'], extra: Partial<ImportEntryView> = {}, display: Partial<ImportEntryView['display']> = {}): ImportEntryView {
  return {
    id, batchId: 1, outcome, reasonCode: null, entityType: null, entityId: null, candidateIds: [], resolution: null, resolvedAt: null,
    display: {
      direction: 'SELL', marketHashName: 'AK-47 | Redline (Field-Tested)', name: 'AK-47 | Redline', localizedName: null, imageUrl: null,
      catalogId: 'skin-ak-redline', category: 'SKIN', variant: 'NORMAL', floatValue: 0.2534, paintSeed: 661, phase: null, priceCents: 1250,
      currency: 'USD', date: '2026-11-20T14:00:00.000Z', state: 'pending', ...display,
    },
    ...extra,
  };
}

const withoutPurchase = (id: number, name = 'AK-47 | Redline') => entry(id, 'FAILED', { reasonCode: 'PURCHASE_NOT_FOUND', allowedActions: ['CREATE_PURCHASE', 'MARK_WON', 'IGNORE'] }, { name });
const duplicate = (id: number) => entry(id, 'POSSIBLE_DUPLICATE', { candidateIds: [5, 6], allowedActions: ['CREATE', 'LINK', 'IGNORE'] });

const ZERO_COUNTS = {
  purchasesCreated: 0, salesCreated: 0, matched: 0, known: 0, beforeCutoff: 0, notTransferred: 0, review: 0, reverted: 0, failed: 0,
  unknownState: 0, deferredSales: 0, withoutPurchase: 0,
};
function batch(extra: Partial<ImportBatchView> = {}): ImportBatchView {
  return {
    id: 7, source: 'CSFLOAT', trigger: 'MANUAL', status: 'DONE', startedAt: '2026-11-22T15:00:00.000Z', finishedAt: '2026-11-22T15:00:03.000Z', fullScan: false,
    cutoffAt: '2026-11-01T00:00:00.000Z', pagesRead: { trades: 1, transactions: 1 }, counts: { ...ZERO_COUNTS }, warnings: [], unknownTypes: {}, errorCode: null,
    undoneAt: null, undoable: false, openEntriesCount: 0, entries: [], ...extra,
  } as unknown as ImportBatchView;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
const view = (ui: React.ReactElement) => renderUi(ui, { client: newClient(), withToast: true });

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getCsfloatIntegration.mockResolvedValue(INTEGRATION);
  api.listStores.mockResolvedValue(STORES);
  api.getSettings.mockResolvedValue({ fxManualRateBounds: { JPY: { min: 50, max: 400 } } });
});
afterEach(cleanup);

// 12.9 (QA): payload de cada escolha, lote e estado indeterminado.
describe('ImportEntriesList: payload de cada escolha', () => {
  test('Criar mesmo assim chama CREATE', async () => {
    api.resolveImportEntry.mockResolvedValue({ resolution: 'CREATED' });
    view(<ImportEntriesList entries={[duplicate(1)]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create anyway' }));
    await waitFor(() => expect(api.resolveImportEntry).toHaveBeenLastCalledWith(1, { action: 'CREATE' }));
  });

  test('Ligar usa o candidato escolhido como targetId', async () => {
    api.resolveImportEntry.mockResolvedValue({ resolution: 'LINKED' });
    view(<ImportEntriesList entries={[duplicate(1)]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Link to entry #6' }));
    await waitFor(() => expect(api.resolveImportEntry).toHaveBeenCalledWith(1, { action: 'LINK', targetId: 6 }));
    expect(api.resolveImportEntry).toHaveBeenCalledTimes(1);
  });

  test('Ignorar na pendência com duplicata chama IGNORE sem outros campos', async () => {
    api.resolveImportEntry.mockResolvedValue({ resolution: 'IGNORED' });
    view(<ImportEntriesList entries={[duplicate(1)]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ignore' }));
    await waitFor(() => expect(api.resolveImportEntry).toHaveBeenCalledWith(1, { action: 'IGNORE' }));
  });

  test('"Foi drop" abre o diálogo e só depois chama MARK_WON (sem acquiredAt por padrão)', async () => {
    api.resolveImportEntry.mockResolvedValue({ resolution: 'CREATED' });
    view(<ImportEntriesList entries={[withoutPurchase(1)]} />);
    await userEvent.click(screen.getByRole('button', { name: 'I received this item (drop)' }));
    expect(api.resolveImportEntry).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Enter as received' }));
    await waitFor(() => expect(api.resolveImportEntry).toHaveBeenCalledWith(1, { action: 'MARK_WON' }));
  });

  test('"Lançar compra" abre o modal de lançamento e não chama a API sozinho', async () => {
    view(<ImportEntriesList entries={[withoutPurchase(1)]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Enter purchase' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(api.resolveImportEntry).not.toHaveBeenCalled();
  });

  test('na aba Ignoradas, a escolha de reabrir chama REOPEN', async () => {
    api.reopenImportEntry.mockResolvedValue({});
    view(<ImportEntriesList ignoredList entries={[entry(3, 'FAILED', { resolution: 'IGNORED', allowedActions: ['REOPEN'] })]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Back to review' }));
    await waitFor(() => expect(api.reopenImportEntry).toHaveBeenCalledWith(3));
    expect(api.resolveImportEntry).not.toHaveBeenCalled();
  });
});

describe('ImportEntriesList: lote', () => {
  test('lote de "Foi drop" confirma no diálogo e manda MARK_WON com todos os ids', async () => {
    api.bulkResolveImportEntries.mockResolvedValue({});
    view(<ImportEntriesList entries={[withoutPurchase(1, 'Item A'), withoutPurchase(2, 'Item B')]} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all in Sale without a purchase in the app' }));
    const bar = screen.getByRole('region', { name: 'Selected trades' });
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: 'I received this item (drop)' }));
    expect(api.bulkResolveImportEntries).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Enter as received' }));
    await waitFor(() => expect(api.bulkResolveImportEntries).toHaveBeenCalledWith({ action: 'MARK_WON', entryIds: [1, 2] }));
  });

  test('seleção de grupos diferentes: só as ações comuns (sem "Lançar compra" nem "Foi drop")', async () => {
    view(<ImportEntriesList entries={[withoutPurchase(1, 'Item A'), duplicate(2)]} />);
    const boxes = screen.getAllByRole('checkbox').filter((box) => !/all in/.test(box.getAttribute('aria-label') ?? ''));
    expect(boxes).toHaveLength(2);
    for (const box of boxes) await userEvent.click(box);
    const bar = screen.getByRole('region', { name: 'Selected trades' });
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Ignore' })).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'Enter purchase' })).toBeNull();
    expect(within(bar).queryByRole('button', { name: 'I received this item (drop)' })).toBeNull();
  });

  test('checkbox do grupo: vazio, completo e parcial (indeterminado) ao desmarcar uma', async () => {
    view(<ImportEntriesList entries={[withoutPurchase(1, 'Item A'), withoutPurchase(2, 'Item B'), withoutPurchase(3, 'Item C')]} />);
    const group = () => screen.getByRole('checkbox', { name: /^Select all in / }) as HTMLInputElement;
    expect(group().indeterminate).toBe(false);
    await userEvent.click(group());
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(group().indeterminate).toBe(false);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Item B' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(group().indeterminate).toBe(true);
  });

  test('falha do lote sem motivo: mostra o resumo, o código e mantém a barra', async () => {
    api.bulkResolveImportEntries.mockRejectedValue(
      new ApiRequestError('IMPORT_BULK_CONFLICT', 'c', 409, { params: { failures: [{ entryId: 1, code: 'IMPORT_ENTRY_CONFLICT', reason: null }] } }),
    );
    view(<ImportEntriesList entries={[withoutPurchase(1, 'Item A'), withoutPurchase(2, 'Item B')]} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all in Sale without a purchase in the app' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Selected trades' })).getByRole('button', { name: 'Ignore' }));
    await waitFor(() => expect(screen.getByText(/1 trade could not be resolved/)).toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Selected trades' })).toBeInTheDocument();
  });
});
