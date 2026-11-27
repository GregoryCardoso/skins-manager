// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderUi } from '@/test/renderUi';
import type { IntegrationView } from '@/types/api';

// S4 (12.11): substitui as verificações por código-fonte do antigo CsfloatIntegrationCard.qa91.test.ts (bloco "o que depende de clique")
// por comportamento na tela: o que já estava em CsfloatIntegrationCard.test.tsx não se repete aqui.
const api = vi.hoisted(() => ({
  getCsfloatIntegration: vi.fn(),
  saveCsfloatApiKey: vi.fn(),
  removeCsfloatApiKey: vi.fn(),
  testCsfloatConnection: vi.fn(),
  switchCsfloatAccount: vi.fn(),
  updateCsfloatIntegration: vi.fn(),
  updateStore: vi.fn(),
  runCsfloatImport: vi.fn(),
  changeCutoff: vi.fn(),
}));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));

import CsfloatIntegrationCard from './CsfloatIntegrationCard';

const BASE: IntegrationView = {
  source: 'CSFLOAT', storeId: 1, storeName: 'CSFloat', storeCurrency: 'USD', storeSaleFeeRate: 0.02, storeWithdrawalFeeRate: 0.025,
  hasApiKey: false, apiKeyMasked: null, apiKeySavedAt: null, accountLinked: false, autoImportOnOpen: false, autoImportPaused: false,
  tradesCutoffAt: null, lastImportAt: null, lastImportStatus: null, lastImportErrorCode: null,
  importInProgress: false, openEntriesCount: 0, suggestedCutoffAt: null, helpUrl: 'https://csfloat.com/profile',
};
const WITH_KEY: IntegrationView = { ...BASE, hasApiKey: true, apiKeyMasked: '****a1b2', accountLinked: true, tradesCutoffAt: '2026-11-01T00:00:00.000Z' };

let client: QueryClient;
function renderCard(view: IntegrationView) {
  api.getCsfloatIntegration.mockResolvedValue(view);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderUi(<CsfloatIntegrationCard />, { client, withToast: true });
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(cleanup);

describe('chave: mostrar e salvar', () => {
  test('com a chave visível, ao salvar o campo é limpo e volta a esconder; nada vai para o console nem para o armazenamento do navegador', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    api.saveCsfloatApiKey.mockResolvedValue({});
    renderCard(BASE);
    const input = (await screen.findByLabelText('API key')) as HTMLInputElement;
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(input).toHaveAttribute('type', 'text');
    await user.click(input);
    await user.paste('SEGREDO-abcdefghij');
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    await waitFor(() => expect(api.saveCsfloatApiKey).toHaveBeenCalledWith('SEGREDO-abcdefghij'));
    await waitFor(() => expect(input.value).toBe(''));
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show' })).toHaveAttribute('aria-pressed', 'false');
    expect(JSON.stringify({ ...localStorage })).not.toContain('SEGREDO');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('SEGREDO');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('o campo tem também autocorreção e autocapitalização desligadas', async () => {
    renderCard(BASE);
    const input = await screen.findByLabelText('API key');
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('autocapitalize', 'off');
  });

  test('salvar a chave invalida as consultas (a tela recarrega sozinha)', async () => {
    const user = userEvent.setup();
    api.saveCsfloatApiKey.mockResolvedValue({});
    renderCard(BASE);
    const spy = vi.spyOn(client, 'invalidateQueries');
    await user.click(await screen.findByLabelText('API key'));
    await user.paste('abcdefghij1234567890');
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });
});

describe('confirmações', () => {
  test('Remover a chave pede confirmação: cancelar não remove, confirmar remove', async () => {
    const user = userEvent.setup();
    api.removeCsfloatApiKey.mockResolvedValue({});
    renderCard(WITH_KEY);
    await user.click(await screen.findByRole('button', { name: 'More options' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Remove key' }));
    let dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove the CSFloat key?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.removeCsfloatApiKey).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Remove key' }));
    dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove key' }));
    await waitFor(() => expect(api.removeCsfloatApiKey).toHaveBeenCalled());
  });

  test('Trocar de conta (depois de um teste com outra conta) pede confirmação antes de trocar', async () => {
    const user = userEvent.setup();
    api.testCsfloatConnection.mockResolvedValue({ ok: true, username: 'outro', accountMatches: false, feeCheck: null });
    renderCard(WITH_KEY);
    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    await screen.findByText(/belongs to another CSFloat account/);
    await user.click(screen.getByRole('button', { name: 'Switch account' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(api.switchCsfloatAccount).not.toHaveBeenCalled();
  });
});

describe('resultado do teste de conexão', () => {
  test('mostra "Connected as" com o nome vindo da resposta; sem nome, só "Connection working."; nada fica no cache', async () => {
    const user = userEvent.setup();
    api.testCsfloatConnection.mockResolvedValue({ ok: true, username: 'jogador42', accountMatches: true, feeCheck: null });
    renderCard(WITH_KEY);
    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connected as jogador42')).toBeInTheDocument();
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data))).not.toContain('jogador42');
    cleanup();
    api.testCsfloatConnection.mockResolvedValue({ ok: true, username: null, accountMatches: true, feeCheck: null });
    renderCard(WITH_KEY);
    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connection working.')).toBeInTheDocument();
  });

  const feeCheck = (matches: boolean | null) => ({
    accountSaleFeeRate: 0.03, storeSaleFeeRate: 0.02, saleFeeMatches: matches,
    accountWithdrawalFeeRate: 0.025, storeWithdrawalFeeRate: 0.025, withdrawalFeeMatches: true,
  });

  test('"Update the store fees" só aparece com taxa diferente e loja definida, e pede confirmação antes de gravar', async () => {
    const user = userEvent.setup();
    api.updateStore.mockResolvedValue({});
    api.testCsfloatConnection.mockResolvedValue({ ok: true, username: 'eu', accountMatches: true, feeCheck: feeCheck(false) });
    renderCard(WITH_KEY);
    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    await user.click(await screen.findByRole('button', { name: 'Update the store fees' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(api.updateStore).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/Sales already recorded do not change/)).toBeInTheDocument();
  });

  test('taxas iguais: sem aviso e sem o botão de atualizar a loja', async () => {
    const user = userEvent.setup();
    api.testCsfloatConnection.mockResolvedValue({ ok: true, username: 'eu', accountMatches: true, feeCheck: feeCheck(true) });
    renderCard(WITH_KEY);
    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    await screen.findByText('Connected as eu');
    expect(screen.queryByRole('button', { name: 'Update the store fees' })).toBeNull();
  });

  test('taxa diferente mas sem loja vinculada: sem o botão de atualizar a loja', async () => {
    const user = userEvent.setup();
    api.testCsfloatConnection.mockResolvedValue({ ok: true, username: 'eu', accountMatches: true, feeCheck: feeCheck(false) });
    renderCard({ ...WITH_KEY, storeId: null, storeName: null, storeCurrency: null });
    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    await screen.findByText('Connected as eu');
    expect(screen.queryByRole('button', { name: 'Update the store fees' })).toBeNull();
  });
});

describe('seção Integrações (D317)', () => {
  test('o card não oferece seletor de loja', async () => {
    renderCard(WITH_KEY);
    await screen.findByText('Saved key: ****a1b2');
    expect(document.querySelector('select')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
