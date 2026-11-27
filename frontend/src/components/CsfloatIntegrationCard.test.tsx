// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderUi } from '@/test/renderUi';
import type { IntegrationView } from '@/types/api';

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
import CsfloatSetupGuide, { CSFLOAT_PROFILE_URL } from './CsfloatSetupGuide';

const BASE: IntegrationView = {
  source: 'CSFLOAT', storeId: 1, storeName: 'CSFloat', storeCurrency: 'USD', storeSaleFeeRate: 0.02, storeWithdrawalFeeRate: 0.025,
  hasApiKey: false, apiKeyMasked: null, apiKeySavedAt: null, accountLinked: false, autoImportOnOpen: false, autoImportPaused: false,
  tradesCutoffAt: null, lastImportAt: null, lastImportStatus: null, lastImportErrorCode: null,
  importInProgress: false, openEntriesCount: 0, suggestedCutoffAt: null, helpUrl: 'javascript:alert(1)',
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

describe('guia do CSFloat', () => {
  test('5 passos, cada um com ilustração de alt traduzido; o botão só leva ao endereço fixo (a helpUrl da API não é usada)', async () => {
    renderCard(BASE);
    const guide = await screen.findByTestId('csfloat-setup-guide');
    const images = within(guide).getAllByRole('img');
    expect(images).toHaveLength(5);
    for (const image of images) expect(image.getAttribute('aria-label')).toMatch(/^Illustration: /);
    expect(within(guide).getByRole('img', { name: 'Illustration: a browser window with the CSFloat address.' })).toBeInTheDocument();
    const open = within(guide).getByRole('link', { name: /Open CSFloat/ });
    expect(open).toHaveAttribute('href', CSFLOAT_PROFILE_URL);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    // um só link no guia, e nada de javascript: na página
    expect(within(guide).getAllByRole('link')).toHaveLength(1);
    expect(document.body.innerHTML).not.toContain('javascript:');
  });

  test('as ilustrações usam só formas genéricas: sem imagem remota, logo ou nome de marca', () => {
    renderUi(<CsfloatSetupGuide />);
    expect(document.querySelectorAll('svg image, img')).toHaveLength(0);
    expect(document.querySelector('svg')?.outerHTML).not.toMatch(/https?:\/\//);
  });

  test('sem chave o guia aparece aberto; com chave fica recolhido em "Como conseguir a chave"', async () => {
    const { unmount } = renderCard(BASE);
    expect(await screen.findByTestId('csfloat-setup-guide')).toBeInTheDocument();
    unmount();
    renderCard(WITH_KEY);
    await screen.findByText('Saved key: ****a1b2');
    expect(screen.queryByTestId('csfloat-setup-guide')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'How to create the key?' }));
    expect(await screen.findByTestId('csfloat-setup-guide')).toBeInTheDocument();
  });
});

describe('validação da chave ao digitar e ao colar', () => {
  const field = () => screen.getByLabelText('API key') as HTMLInputElement;
  const save = () => screen.getByRole('button', { name: 'Save key' });

  test('vazio: "Salvar" desabilitado, sem mensagem', async () => {
    renderCard(BASE);
    await screen.findByLabelText('API key');
    expect(save()).toBeDisabled();
    expect(screen.queryByText(/looks too/)).toBeNull();
  });

  test('chave colada com espaço ou quebra de linha no fim é aceita (formato válido + tamanho) e salva aparada', async () => {
    const user = userEvent.setup();
    api.saveCsfloatApiKey.mockResolvedValue({});
    renderCard(BASE);
    await screen.findByLabelText('API key');
    await user.click(field());
    await user.paste('abcdefghij1234567890  ');
    expect(await screen.findByText('Valid format · 20 characters')).toBeInTheDocument();
    expect(save()).toBeEnabled();
    await user.click(save());
    await waitFor(() => expect(api.saveCsfloatApiKey).toHaveBeenCalledWith('abcdefghij1234567890'));
    // depois de salvar o campo é limpo
    await waitFor(() => expect(field().value).toBe(''));
  });

  test('curta, longa ou com espaço no meio: mensagem junto do campo e "Salvar" desabilitado', async () => {
    const user = userEvent.setup();
    renderCard(BASE);
    await screen.findByLabelText('API key');
    await user.click(field());
    await user.paste('abc');
    expect(await screen.findByText('The key looks too short. Check that you copied all of it.')).toBeInTheDocument();
    expect(save()).toBeDisabled();
    await user.clear(field());
    await user.paste('a'.repeat(513));
    expect(await screen.findByText(/looks too long/)).toBeInTheDocument();
    expect(save()).toBeDisabled();
    await user.clear(field());
    await user.paste('abcdefgh ijklmnop');
    expect(await screen.findByText(/has spaces in the middle/)).toBeInTheDocument();
    expect(save()).toBeDisabled();
    expect(api.saveCsfloatApiKey).not.toHaveBeenCalled();
  });

  test('o campo evita autocompletar e correção; mostrar/ocultar é um botão com aria-pressed', async () => {
    const user = userEvent.setup();
    renderCard(BASE);
    const input = await screen.findByLabelText('API key');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
    const toggle = screen.getByRole('button', { name: 'Show' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('a chave digitada nunca entra no cache de consultas', async () => {
    const user = userEvent.setup();
    api.saveCsfloatApiKey.mockResolvedValue({});
    renderCard(BASE);
    await screen.findByLabelText('API key');
    await user.click(field());
    await user.paste('SEGREDO-abcdefghij');
    await user.click(save());
    await waitFor(() => expect(api.saveCsfloatApiKey).toHaveBeenCalled());
    const cached = JSON.stringify(client.getQueryCache().getAll().map((q) => [q.queryKey, q.state.data]));
    expect(cached).not.toContain('SEGREDO');
  });
});

describe('"Mais opções" e importação', () => {
  async function openMore(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'More options' }));
    return screen.findByRole('menu');
  }

  test('o menu traz Varredura completa, Alterar data de corte (link para Importações) e Remover chave; sem "Trocar de conta"', async () => {
    const user = userEvent.setup();
    renderCard(WITH_KEY);
    const menu = await openMore(user);
    expect(within(menu).getByRole('menuitem', { name: 'Full scan' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Change cutoff date' })).toHaveAttribute('href', expect.stringMatching(/^\/imports\/?#cutoff$/));
    // vai pelo roteador (next/link), não por <a> cru que recarrega a página: o clique é interceptado quando há roteador
    expect(within(menu).getByRole('menuitem', { name: 'Change cutoff date' }).tagName).toBe('A');
    expect(within(menu).getByRole('menuitem', { name: 'Remove key' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Switch account' })).toBeNull();
  });

  test('Varredura completa abre a confirmação com o aviso de tempo e só então importa', async () => {
    const user = userEvent.setup();
    api.runCsfloatImport.mockResolvedValue({ batch: { id: 1, counts: {}, entries: [], warnings: [], undoable: false, finishedAt: '2026-11-27T10:00:00.000Z' } });
    renderCard(WITH_KEY);
    const menu = await openMore(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Full scan' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/It can take a few minutes/)).toBeInTheDocument();
    expect(api.runCsfloatImport).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Run full scan' }));
    await waitFor(() => expect(api.runCsfloatImport).toHaveBeenCalledWith({ fullScan: true }));
  });

  test('"Trocar de conta" só aparece no menu depois de um teste que mostra outra conta', async () => {
    const user = userEvent.setup();
    api.testCsfloatConnection.mockResolvedValue({ username: 'outro', accountMatches: false, feeCheck: null });
    renderCard(WITH_KEY);
    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText(/belongs to another CSFloat account/)).toBeInTheDocument();
    const menu = await openMore(user);
    expect(within(menu).getByRole('menuitem', { name: 'Switch account' })).toBeInTheDocument();
  });

  test('"Importar ao abrir" é um Switch e grava na hora', async () => {
    const user = userEvent.setup();
    api.updateCsfloatIntegration.mockResolvedValue({});
    renderCard(WITH_KEY);
    const toggle = await screen.findByRole('switch', { name: 'Import when the app opens' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(api.updateCsfloatIntegration).toHaveBeenCalledWith({ autoImportOnOpen: true }));
  });

  test('sem a loja do CSFloat: aviso para criar a loja', async () => {
    renderCard({ ...WITH_KEY, storeId: null, storeName: null, storeCurrency: null });
    expect(await screen.findByText(/The CSFloat store was not found/)).toBeInTheDocument();
  });
});

describe('QA 12.9: bordas do card', () => {
  test('"Trocar de conta" não aparece quando o teste confirma que a conta confere', async () => {
    const user = userEvent.setup();
    api.testCsfloatConnection.mockResolvedValue({ username: 'eu', accountMatches: true, feeCheck: null });
    renderCard(WITH_KEY);
    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(api.testCsfloatConnection).toHaveBeenCalled());
    await user.click(await screen.findByRole('button', { name: 'More options' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Switch account' })).toBeNull();
  });

  test('"Abrir o CSFloat" só aponta para o endereço fixo, mesmo com helpUrl diferente', async () => {
    renderCard({ ...BASE, helpUrl: 'https://evil.example/phish' });
    const guide = await screen.findByTestId('csfloat-setup-guide');
    const links = within(guide).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://csfloat.com/profile');
    expect(CSFLOAT_PROFILE_URL).toBe('https://csfloat.com/profile');
    expect(document.body.innerHTML).not.toContain('evil.example');
  });

  test('chave com espaço no início também é aceita e salva aparada; só espaços mantém "Salvar" desabilitado', async () => {
    const user = userEvent.setup();
    api.saveCsfloatApiKey.mockResolvedValue({});
    renderCard(BASE);
    const input = (await screen.findByLabelText('API key')) as HTMLInputElement;
    const save = screen.getByRole('button', { name: 'Save key' });
    await user.click(input);
    await user.paste('    ');
    expect(save).toBeDisabled();
    await user.clear(input);
    await user.paste('  abcdefghij1234567890');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(api.saveCsfloatApiKey).toHaveBeenCalledWith('abcdefghij1234567890'));
  });

  test('chave de 1 caractere: mostra "curta"; no limite de 512 aceita', async () => {
    const user = userEvent.setup();
    renderCard(BASE);
    const input = await screen.findByLabelText('API key');
    const save = screen.getByRole('button', { name: 'Save key' });
    await user.click(input);
    await user.paste('a'.repeat(512));
    expect(await screen.findByText('Valid format · 512 characters')).toBeInTheDocument();
    expect(save).toBeEnabled();
  });
});
