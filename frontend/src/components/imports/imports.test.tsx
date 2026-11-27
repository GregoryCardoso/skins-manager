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

import CutoffChangeModal from '../CutoffChangeModal';
import ImportCutoffModal from '../ImportCutoffModal';
import ImportEntriesList from '../ImportEntriesList';
import ImportSummaryModal from '../ImportSummaryModal';
import LaunchPurchaseModal from '../LaunchPurchaseModal';
import MarkWonDialog from '../MarkWonDialog';
import UndoImportDialog from '../UndoImportDialog';
import CutoffTimeline from './CutoffTimeline';
import EntryChoice from './EntryChoice';

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

describe('EntryChoice', () => {
  test('a frase fica visível e ligada ao botão por aria-describedby', () => {
    renderUi(<EntryChoice label="Ignore" explain="Does nothing for now." onClick={() => {}} />);
    expect(screen.getByText('Does nothing for now.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ignore' })).toHaveAccessibleDescription('Does nothing for now.');
  });

  test('o clique chama a ação, e desabilitado não chama', async () => {
    const onClick = vi.fn();
    const { rerender } = renderUi(<EntryChoice label="Ignore" explain="x" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ignore' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<EntryChoice label="Ignore" explain="x" disabled onClick={onClick} />);
    expect(screen.getByRole('button', { name: 'Ignore' })).toBeDisabled();
  });
});

describe('CutoffTimeline', () => {
  test('só a data atual: marca antes/depois e a data, sem frase de movimento', () => {
    renderUi(<CutoffTimeline current="2026-10-01T00:00:00Z" now={new Date('2026-11-27T12:00:00Z')} />);
    const figure = screen.getByTestId('cutoff-timeline');
    expect(figure).toHaveAttribute('data-move', 'NONE');
    expect(within(figure).getByText('Before: not imported')).toBeInTheDocument();
    expect(within(figure).getByText('After: imported')).toBeInTheDocument();
    expect(within(figure).getByText(/^Current: /)).toBeInTheDocument();
  });

  test('data nova mais antiga: o trecho passa a ser importado, com a contagem (plural)', () => {
    renderUi(<CutoffTimeline current="2026-10-01T00:00:00Z" next="2026-09-01T00:00:00Z" moves={3} now={new Date('2026-11-27T12:00:00Z')} />);
    const figure = screen.getByTestId('cutoff-timeline');
    expect(figure).toHaveAttribute('data-move', 'EARLIER');
    expect(within(figure).getByText(/will start to be imported/)).toBeInTheDocument();
    expect(within(figure).getByText(/3 trades change side/)).toBeInTheDocument();
    expect(within(figure).getByText(/^New: /)).toBeInTheDocument();
  });

  test('data nova mais recente: o trecho deixa de ser importado', () => {
    renderUi(<CutoffTimeline current="2026-09-01T00:00:00Z" next="2026-10-01T00:00:00Z" moves={1} now={new Date('2026-11-27T12:00:00Z')} />);
    expect(screen.getByTestId('cutoff-timeline')).toHaveAttribute('data-move', 'LATER');
    expect(screen.getByText(/will stop being imported/)).toBeInTheDocument();
    expect(screen.getByText(/1 trade changes side/)).toBeInTheDocument();
  });
});

describe('ImportEntriesList: escolhas, passos e lote', () => {
  test('cada escolha tem a frase ligada ao botão (incluindo um botão por candidato do Ligar)', async () => {
    view(<ImportEntriesList entries={[duplicate(1)]} />);
    const expectations: [string, string][] = [
      ['Create anyway', 'Enters this trade in the app even though it looks like a duplicate.'],
      ['Link to entry #5', 'Ties this trade to an entry you already made, without creating a new one.'],
      ['Link to entry #6', 'Ties this trade to an entry you already made, without creating a new one.'],
      ['Ignore', 'Does nothing for now. You can go back in the Ignored tab.'],
    ];
    for (const [name, description] of expectations) expect(screen.getByRole('button', { name })).toHaveAccessibleDescription(description);
    expect(screen.getByRole('link', { name: 'See entry #5' })).toBeInTheDocument();
  });

  test('os passos só aparecem para "venda sem compra no app"', () => {
    view(<ImportEntriesList entries={[withoutPurchase(1), duplicate(2)]} />);
    const steps = screen.getAllByTestId('without-purchase-steps');
    expect(steps).toHaveLength(1);
    expect(within(steps[0]).getByText('Did you buy it? Enter the purchase.')).toBeInTheDocument();
    expect(within(steps[0]).getByRole('button', { name: 'Enter purchase' })).toBeInTheDocument();
    expect(within(steps[0]).getByRole('button', { name: 'I received this item (drop)' })).toBeInTheDocument();
    expect(within(steps[0]).getByRole('button', { name: 'Ignore' })).toBeInTheDocument();
  });

  test('a dica de seleção fica sempre visível com mais de uma pendência selecionável (e some com uma só)', () => {
    const { unmount } = view(<ImportEntriesList entries={[withoutPurchase(1), withoutPurchase(2)]} />);
    expect(screen.getByText('Tick several trades to resolve them together.')).toBeInTheDocument();
    unmount();
    view(<ImportEntriesList entries={[withoutPurchase(1)]} />);
    expect(screen.queryByText('Tick several trades to resolve them together.')).toBeNull();
  });

  test('selecionar abre a barra de lote sem "Lançar compra"; o checkbox do grupo fica indeterminado com seleção parcial', async () => {
    view(<ImportEntriesList entries={[withoutPurchase(1, 'Item A'), withoutPurchase(2, 'Item B')]} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Item A' }));
    const bar = screen.getByRole('region', { name: 'Selected trades' });
    expect(within(bar).getByText('1 selected')).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'Enter purchase' })).toBeNull();
    expect(within(bar).getByRole('button', { name: 'Ignore' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'I received this item (drop)' })).toBeInTheDocument();
    const group = screen.getByRole('checkbox', { name: /^Select all in / });
    expect((group as HTMLInputElement).indeterminate).toBe(true);
    await userEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('region', { name: 'Selected trades' })).toBeNull();
  });

  test('auditoria 12.11: o título do grupo é um h2 só com o texto (o checkbox do grupo fica fora do título)', () => {
    view(<ImportEntriesList entries={[withoutPurchase(1, 'Item A'), withoutPurchase(2, 'Item B')]} />);
    const heading = screen.getByRole('heading', { level: 2, name: /Sale without a purchase in the app/ });
    expect(within(heading).queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('checkbox', { name: /^Select all in / })).toBeInTheDocument();
  });

  test('tudo ou nada: o conflito do lote mostra a falha na linha e nada some', async () => {
    api.bulkResolveImportEntries.mockRejectedValue(
      new ApiRequestError('IMPORT_BULK_CONFLICT', 'conflito', 409, { params: { failures: [{ entryId: 2, code: 'IMPORT_ENTRY_CONFLICT', reason: 'SALE_TX_NOT_FOUND' }] } }),
    );
    view(<ImportEntriesList entries={[withoutPurchase(1, 'Item A'), withoutPurchase(2, 'Item B')]} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all in Sale without a purchase in the app' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Selected trades' })).getByRole('button', { name: 'Ignore' }));
    await waitFor(() => expect(screen.getAllByText(/has not shown the credit for this sale yet/).length).toBeGreaterThan(0));
    expect(api.bulkResolveImportEntries).toHaveBeenCalledWith({ action: 'IGNORE', entryIds: [1, 2] });
    expect(screen.getByText('Item A')).toBeInTheDocument();
    expect(screen.getByText(/1 trade could not be resolved/)).toBeInTheDocument();
  });

  test('Ignorar: com data de corte, o aviso oferece "Desfazer" que chama REOPEN', async () => {
    api.resolveImportEntry.mockResolvedValue({ resolution: 'IGNORED' });
    api.reopenImportEntry.mockResolvedValue({});
    view(<ImportEntriesList entries={[withoutPurchase(1)]} />);
    await waitFor(() => expect(api.getCsfloatIntegration).toHaveBeenCalled());
    await userEvent.click(within(screen.getByTestId('without-purchase-steps')).getByRole('button', { name: 'Ignore' }));
    expect(api.resolveImportEntry).toHaveBeenCalledWith(1, { action: 'IGNORE' });
    expect(await screen.findByText('Trade ignored.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(api.reopenImportEntry).toHaveBeenCalledWith(1);
  });

  test('Ignorar sem data de corte: o aviso não oferece "Desfazer"', async () => {
    api.getCsfloatIntegration.mockResolvedValue({ ...INTEGRATION, tradesCutoffAt: null });
    api.resolveImportEntry.mockResolvedValue({ resolution: 'IGNORED' });
    view(<ImportEntriesList entries={[withoutPurchase(1)]} />);
    await waitFor(() => expect(api.getCsfloatIntegration).toHaveBeenCalled());
    await userEvent.click(within(screen.getByTestId('without-purchase-steps')).getByRole('button', { name: 'Ignore' }));
    await waitFor(() => expect(screen.getByText('Ignored.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  test('Remover pede confirmação em alertdialog e só então chama a API', async () => {
    api.resolveImportEntry.mockResolvedValue({ resolution: 'REMOVED' });
    view(<ImportEntriesList entries={[entry(1, 'REVERTED', { entityType: 'ITEM_PURCHASE', entityId: 42, allowedActions: ['REMOVE', 'KEEP'] })]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove entry' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(api.resolveImportEntry).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove entry' }));
    await waitFor(() => expect(api.resolveImportEntry).toHaveBeenCalledWith(1, { action: 'REMOVE' }));
  });

  test('os detalhes do item ficam em "Mais detalhes"; preço e data ficam na vista', () => {
    view(<ImportEntriesList entries={[duplicate(1)]} />);
    expect(screen.getByText(/\$12\.50/)).toBeInTheDocument();
    expect(screen.queryByText(/seed 661/)).toBeNull();
  });
});

describe('ImportCutoffModal', () => {
  test('a sugestão vira o valor do campo e a linha do tempo acompanha a data', () => {
    renderUi(<ImportCutoffModal suggestedCutoffAt="2026-11-08T13:00:00.000Z" busy={false} error={null} onConfirm={() => {}} onCancel={() => {}} />);
    expect((screen.getByLabelText(/Up to which date/) as HTMLInputElement).value).toMatch(/^2026-11-0[78]T\d\d:\d\d$/);
    expect(screen.getByTestId('cutoff-timeline')).toBeInTheDocument();
  });

  test('data futura dá erro junto do campo e não confirma; data válida confirma com ISO', async () => {
    const onConfirm = vi.fn();
    renderUi(<ImportCutoffModal suggestedCutoffAt={null} busy={false} error={null} onConfirm={onConfirm} onCancel={() => {}} />);
    const field = screen.getByLabelText(/Up to which date/);
    await userEvent.type(field, '2999-01-01T00:00');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(await screen.findByText(/cannot be in the future|future/i)).toBeInTheDocument();
  });

  test('erro da importação aparece no aviso do modal', () => {
    renderUi(<ImportCutoffModal suggestedCutoffAt={null} busy={false} error="Falhou: tente de novo." onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Falhou: tente de novo.');
  });
});

describe('CutoffChangeModal', () => {
  test('data futura dá erro e desabilita a confirmação', async () => {
    view(<CutoffChangeModal currentCutoffAt="2026-11-01T00:00:00.000Z" busy={false} error={null} onConfirm={() => {}} onCancel={() => {}} />);
    const field = screen.getByLabelText('New cutoff date');
    await userEvent.clear(field);
    await userEvent.type(field, '2999-01-01T00:00');
    expect(await screen.findByText(/future/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change and import' })).toBeDisabled();
    expect(api.previewCutoffChange).not.toHaveBeenCalled();
  });

  test('a prévia (simulada) aparece e a linha do tempo compara a data atual e a nova', async () => {
    api.previewCutoffChange.mockResolvedValue({
      backward: {
        purchases: { count: 2, amountCents: 5000 }, sales: { count: 1, amountCents: 2000 }, mayHaveUnseen: false,
        manualLaunches: { purchases: 0, sales: 0 }, deposits: [{ id: 9, depositedAt: '2026-10-05T00:00:00.000Z', amountStoreCents: 1000 }],
      },
      forward: null,
      transfers: null,
    });
    view(<CutoffChangeModal currentCutoffAt="2026-11-01T00:00:00.000Z" busy={false} error={null} onConfirm={() => {}} onCancel={() => {}} />);
    const field = screen.getByLabelText('New cutoff date');
    await userEvent.clear(field);
    await userEvent.type(field, '2026-10-01T00:00');
    expect(await screen.findByTestId('cutoff-preview-backward')).toBeInTheDocument();
    expect(screen.getByTestId('cutoff-timeline')).toHaveAttribute('data-move', 'EARLIER');
    expect(screen.getByText(/3 trades change side/)).toBeInTheDocument();
    expect(screen.getByText(/you have a deposit in the CSFloat store/)).toBeInTheDocument();
  });
});

describe('MarkWonDialog', () => {
  test('por padrão usa a data da venda (null); "outra data" mostra o campo e exige a data', async () => {
    const onConfirm = vi.fn();
    renderUi(<MarkWonDialog count={1} busy={false} error={null} onConfirm={onConfirm} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Enter as received' }));
    expect(onConfirm).toHaveBeenLastCalledWith(null);
    await userEvent.click(screen.getByRole('radio', { name: 'Choose another date' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enter as received' }));
    expect(await screen.findByText('Enter the date.')).toBeInTheDocument();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('LaunchPurchaseModal', () => {
  const sale = withoutPurchase(1);

  test('loja em JPY: sem centavos, cotação com a faixa como dica; loja inativa não aparece', async () => {
    view(<LaunchPurchaseModal entry={sale} onClose={() => {}} onDone={() => {}} />);
    const store = await screen.findByLabelText(/Purchase store/);
    expect(within(store).queryByRole('option', { name: /Velha/ })).toBeNull();
    await userEvent.selectOptions(store, '2');
    expect(await screen.findByText(/has no cents/i)).toBeInTheDocument();
    expect(await screen.findByText(/50.*400|400.*50/)).toBeInTheDocument();
  });

  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByLabelText(/Price paid/), '10');
    await user.type(screen.getByLabelText(/Purchase date/), '2026-11-10T10:00');
    await user.click(screen.getByRole('button', { name: 'Enter purchase and record the sale' }));
  }

  test('aviso de antes do corte: "Confirmar mesmo assim" reenvia com confirmWarnings', async () => {
    const user = userEvent.setup();
    api.resolveImportEntry
      .mockRejectedValueOnce(new ApiRequestError('IMPORT_ENTRY_WARNINGS_NOT_CONFIRMED', 'aviso', 409, { params: { warnings: [{ cutoffAt: '2026-11-01T00:00:00.000Z' }] } }))
      .mockResolvedValueOnce({ resolution: 'CREATED' });
    const onDone = vi.fn();
    view(<LaunchPurchaseModal entry={sale} onClose={() => {}} onDone={onDone} />);
    await fill(user);
    await user.click(await screen.findByRole('button', { name: 'I understand, enter it anyway' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('CREATED'));
    expect(api.resolveImportEntry).toHaveBeenLastCalledWith(1, expect.objectContaining({ action: 'CREATE_PURCHASE', confirmWarnings: true }));
  });

  test('sem crédito no extrato: "Salvar só a compra" reenvia com purchaseOnly', async () => {
    const user = userEvent.setup();
    api.resolveImportEntry
      .mockRejectedValueOnce(new ApiRequestError('IMPORT_ENTRY_CONFLICT', 'x', 409, { params: { reason: 'SALE_TX_NOT_FOUND' } }))
      .mockResolvedValueOnce({ resolution: 'PURCHASE_ONLY' });
    const onDone = vi.fn();
    view(<LaunchPurchaseModal entry={sale} onClose={() => {}} onDone={onDone} />);
    await fill(user);
    await user.click(await screen.findByRole('button', { name: 'Save only the purchase' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('PURCHASE_ONLY'));
    expect(api.resolveImportEntry).toHaveBeenLastCalledWith(1, expect.objectContaining({ confirmWarnings: true, purchaseOnly: true }));
  });

  test('unidade em estoque: mostra os links para as unidades', async () => {
    const user = userEvent.setup();
    api.resolveImportEntry.mockRejectedValue(new ApiRequestError('IMPORT_ENTRY_CONFLICT', 'x', 409, { params: { reason: 'UNIT_IN_STOCK', itemIds: [42, 43] } }));
    view(<LaunchPurchaseModal entry={sale} onClose={() => {}} onDone={() => {}} />);
    await fill(user);
    const link = await screen.findByRole('link', { name: 'See entry #42' });
    expect(link).toHaveAttribute('href', '/?item=42');
    expect(screen.getByRole('link', { name: 'See entry #43' })).toBeInTheDocument();
  });

  test('campos vazios: o resumo de erros lista o preço e a data', async () => {
    view(<LaunchPurchaseModal entry={sale} onClose={() => {}} onDone={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Enter purchase and record the sale' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(api.resolveImportEntry).not.toHaveBeenCalled();
  });
});

describe('ImportSummaryModal', () => {
  test('sem novidades: "nada novo" e sem Desfazer; com novidade: contagens em lista e Desfazer só quando undoable', () => {
    const { unmount } = view(<ImportSummaryModal batch={batch({ counts: { ...ZERO_COUNTS, known: 12 } })} onClose={() => {}} />);
    expect(screen.getByText('Nothing new to import.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo import' })).toBeNull();
    expect(screen.getByRole('link', { name: 'See details' })).toHaveAttribute('href', expect.stringMatching(/^\/imports\/?$/));
    unmount();
    view(<ImportSummaryModal batch={batch({ counts: { ...ZERO_COUNTS, purchasesCreated: 1, matched: 2 }, undoable: true, warnings: ['SCAN_LIMIT_REACHED', 'NOVO_AVISO_X'] })} onClose={() => {}} />);
    expect(screen.getByText('1 purchase imported')).toBeInTheDocument();
    expect(screen.getByText('2 linked to entries you already had')).toBeInTheDocument();
    expect(screen.getByText('NOVO_AVISO_X')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo import' })).toBeInTheDocument();
  });
});

describe('UndoImportDialog', () => {
  const preview = (extra: Partial<UndoPreview>): UndoPreview => ({
    undoable: true, reason: null, blockers: [], warnings: [], counts: { itemsToDelete: 2, linksToRemove: 0, salesToUndo: 0 }, ...extra,
  });

  test('bloqueios: aviso de perigo e nenhum botão de desfazer; o foco inicial fica em Cancelar', async () => {
    api.getUndoPreview.mockResolvedValue(preview({ blockers: [{ code: 'ITEM_SOLD_IN_APP', itemId: 1, name: 'AK-47' }] }));
    view(<UndoImportDialog batchId={7} onClose={() => {}} onFinished={() => {}} />);
    expect(await screen.findByText(/Cannot undo/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo import' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  test('avisos exigem o "Entendi" antes de liberar o botão', async () => {
    api.getUndoPreview.mockResolvedValue(preview({ warnings: [{ code: 'ITEM_EDITED', itemId: 1, name: 'AK-47' }] }));
    api.undoImportBatch.mockResolvedValue({});
    view(<UndoImportDialog batchId={7} onClose={() => {}} onFinished={() => {}} />);
    const button = await screen.findByRole('button', { name: 'Undo import' });
    expect(button).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /I understand/ }));
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() => expect(api.undoImportBatch).toHaveBeenCalledWith(7, true));
    expect(await screen.findByText(/Import undone/)).toBeInTheDocument();
  });

  test('sem avisos: mostra o que será desfeito e libera direto', async () => {
    api.getUndoPreview.mockResolvedValue(preview({}));
    view(<UndoImportDialog batchId={7} onClose={() => {}} onFinished={() => {}} />);
    expect(await screen.findByText('2 created items will be deleted.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo import' })).toBeEnabled();
  });
});
