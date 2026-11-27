// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderUi } from '@/test/renderUi';
import type { ImportEntryView, IntegrationView } from '@/types/api';

const api = vi.hoisted(() => ({
  getCsfloatIntegration: vi.fn(),
  listOpenImportEntries: vi.fn(),
  listIgnoredImportEntries: vi.fn(),
  listImportBatches: vi.fn(),
  getImportBatch: vi.fn(),
  runCsfloatImport: vi.fn(),
  changeCutoff: vi.fn(),
  previewCutoffChange: vi.fn(),
  listStores: vi.fn(),
  getSettings: vi.fn(),
}));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));

import ImportsPage from './page';

const INTEGRATION: IntegrationView = {
  source: 'CSFLOAT', storeId: 1, storeName: 'CSFloat', storeCurrency: 'USD', storeSaleFeeRate: 0.02, storeWithdrawalFeeRate: 0.025,
  hasApiKey: true, apiKeyMasked: '****a1b2', apiKeySavedAt: '2026-11-20T10:00:00.000Z', accountLinked: true, autoImportOnOpen: true, autoImportPaused: false,
  tradesCutoffAt: '2026-11-01T00:00:00.000Z', lastImportAt: '2026-11-25T10:00:00.000Z', lastImportStatus: 'OK', lastImportErrorCode: null,
  importInProgress: false, openEntriesCount: 2, suggestedCutoffAt: null, helpUrl: 'https://csfloat.com/profile',
};

function entry(id: number, extra: Partial<ImportEntryView> = {}): ImportEntryView {
  return {
    id, batchId: 1, outcome: 'FAILED', reasonCode: 'PURCHASE_NOT_FOUND', entityType: null, entityId: null, candidateIds: [], resolution: null, resolvedAt: null,
    allowedActions: ['CREATE_PURCHASE', 'MARK_WON', 'IGNORE'],
    display: {
      direction: 'SELL', marketHashName: 'AK-47 | Redline (Field-Tested)', name: `AK-47 | Redline ${id}`, localizedName: null, imageUrl: null, catalogId: 'x',
      category: 'SKIN', variant: 'NORMAL', floatValue: null, paintSeed: null, phase: null, priceCents: 1250, currency: 'USD', date: '2026-11-20T14:00:00.000Z', state: 'pending',
    },
    ...extra,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderUi(<ImportsPage />, { client, withToast: true });
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getCsfloatIntegration.mockResolvedValue(INTEGRATION);
  api.listOpenImportEntries.mockResolvedValue({ entries: [entry(1), entry(2)] });
  api.listIgnoredImportEntries.mockResolvedValue({ entries: [entry(3, { allowedActions: ['REOPEN'] })] });
  api.listImportBatches.mockResolvedValue({ batches: [], nextBefore: null });
  api.listStores.mockResolvedValue([]);
  api.getSettings.mockResolvedValue({});
  window.history.replaceState(null, '', '/imports/');
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('página Importações', () => {
  test('três abas com as contagens; abre em "Para conferir" por padrão', async () => {
    renderPage();
    const review = await screen.findByRole('tab', { name: /To review/ });
    expect(review).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(within(review).getByText('2')).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: /Ignored/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument();
    expect(await screen.findByText('AK-47 | Redline 1')).toBeInTheDocument();
  });

  test('faixa de estado: última importação, data de corte e "Importar ao abrir"', async () => {
    renderPage();
    const status = await screen.findByTestId('imports-status');
    expect(within(status).getByText(/^Last import: /)).toBeInTheDocument();
    expect(within(status).getByText(/^Cutoff date: /)).toBeInTheDocument();
    expect(within(status).getByText('Import on open: on')).toBeInTheDocument();
  });

  test('o hash escolhe a aba: #ignored abre as ignoradas com a lista e "Voltar para pendências"', async () => {
    window.history.replaceState(null, '', '/imports/#ignored');
    renderPage();
    const tab = await screen.findByRole('tab', { name: /Ignored/ });
    await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'));
    expect(await screen.findByText('AK-47 | Redline 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to review' })).toBeInTheDocument();
  });

  test('#cutoff abre o Histórico e mostra o bloco da data de corte com a linha do tempo', async () => {
    window.history.replaceState(null, '', '/imports/#cutoff');
    renderPage();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true'));
    expect(await screen.findByTestId('cutoff-timeline')).toBeInTheDocument();
    expect(document.getElementById('cutoff')).not.toBeNull();
    expect(screen.getByText(/^Cutoff date: /, { selector: 'h2, h3, p, div' })).toBeInTheDocument();
  });

  test('trocar de aba grava o hash na URL', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'History' }));
    expect(window.location.hash).toBe('#history');
    await user.click(screen.getByRole('tab', { name: /To review/ }));
    expect(window.location.hash).toBe('#review');
  });

  test('"Mais opções" → Varredura completa abre a confirmação com o aviso de tempo; só depois chama a API', async () => {
    const user = userEvent.setup();
    api.runCsfloatImport.mockResolvedValue({ batch: { id: 9, counts: {}, entries: [], warnings: [], undoable: false, finishedAt: '2026-11-27T10:00:00.000Z' } });
    renderPage();
    await screen.findByText('AK-47 | Redline 1');
    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Full scan' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/It can take a few minutes/)).toBeInTheDocument();
    expect(api.runCsfloatImport).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Run full scan' }));
    await waitFor(() => expect(api.runCsfloatImport).toHaveBeenCalledWith({ fullScan: true }));
  });

  test('"Importar agora" importa direto quando já há data de corte', async () => {
    const user = userEvent.setup();
    api.runCsfloatImport.mockResolvedValue({ batch: { id: 9, counts: {}, entries: [], warnings: [], undoable: false, finishedAt: '2026-11-27T10:00:00.000Z' } });
    renderPage();
    const button = await screen.findByRole('button', { name: 'Import now' });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(api.runCsfloatImport).toHaveBeenCalledWith({ fullScan: false }));
  });

  test('sem chave: aviso com o caminho das configurações e importação desabilitada', async () => {
    api.getCsfloatIntegration.mockResolvedValue({ ...INTEGRATION, hasApiKey: false, apiKeyMasked: null, tradesCutoffAt: null });
    renderPage();
    expect(await screen.findByTestId('imports-setup')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect CSFloat' })).toHaveAttribute('href', expect.stringContaining('/settings'));
    expect(screen.getByRole('button', { name: 'Import now' })).toBeDisabled();
  });

  test('nada para conferir: estado vazio', async () => {
    api.listOpenImportEntries.mockResolvedValue({ entries: [] });
    renderPage();
    expect(await screen.findByText('Nothing to review.')).toBeInTheDocument();
  });

  test('erro ao carregar as pendências: mensagem e "Tentar de novo"', async () => {
    api.listOpenImportEntries.mockRejectedValueOnce(new Error('falhou')).mockResolvedValue({ entries: [entry(1)] });
    const user = userEvent.setup();
    renderPage();
    const retry = await screen.findByRole('button', { name: 'Try again' });
    await user.click(retry);
    expect(await screen.findByText('AK-47 | Redline 1')).toBeInTheDocument();
  });
});
