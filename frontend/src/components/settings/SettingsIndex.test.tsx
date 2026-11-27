// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderUi, setViewport } from '@/test/renderUi';
import type { Settings } from '@/types/api';

vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => ({ theme: 'DARK', language: 'en' }) }));
vi.mock('@/components/PreferencesSettings', () => ({ default: () => <div>section-preferences</div> }));
vi.mock('@/components/FxRateSettings', () => ({ default: () => <div>section-fx</div> }));
vi.mock('@/components/AgingSettings', () => ({ default: () => <div>section-aging</div> }));
vi.mock('@/components/IntegrationsSettings', () => ({ default: () => <section id="csfloat">section-integrations</section> }));
vi.mock('@/components/BackupSettings', () => ({ default: () => <div>section-backup</div> }));
vi.mock('@/components/CatalogSettings', () => ({ default: () => <div>section-catalog</div> }));
vi.mock('@/components/AboutSettings', () => ({ default: () => <div>section-about</div> }));

const api = vi.hoisted(() => ({
  getCsfloatIntegration: vi.fn(),
  getCatalogStatus: vi.fn(),
  getHealth: vi.fn(),
  getBackupInfo: vi.fn(),
}));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));

import SettingsIndex from './SettingsIndex';

const SETTINGS = {
  displayCurrency: 'USD', fxRates: [], requiredFxCurrencies: [], fastTurnoverDays: 7, slowItemDays: 21, theme: 'DARK', language: 'en',
} as unknown as Settings;

function renderIndex() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderUi(<SettingsIndex settings={SETTINGS} />, { client });
}

beforeEach(() => {
  setViewport(1440, 900);
  window.location.hash = '';
  api.getCsfloatIntegration.mockResolvedValue({ hasApiKey: true, openEntriesCount: 2 });
  api.getCatalogStatus.mockResolvedValue({ total: 1234, catalogUpdatedAt: '2026-11-20T10:00:00.000Z', countsBySource: {} });
  api.getHealth.mockResolvedValue({ version: '2.0.0', timestamp: '2026-11-27T12:00:00.000Z' });
  api.getBackupInfo.mockResolvedValue({ dataDir: 'C:/d', backupsDir: 'C:/d/backups', autoBackupKeep: 10, canOpenFolder: true });
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('índice de Configurações', () => {
  test('as 7 seções aparecem como abas, com o estado de cada uma na segunda linha (sem abrir)', async () => {
    renderIndex();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.querySelector('span > span')?.textContent)).toEqual([
      'Preferences', 'Exchange rates', 'Turnover limits', 'Integrations', 'Backup', 'Item catalog', 'About',
    ].map((name) => expect.stringContaining(name.split(' ')[0])));
    expect(await screen.findByText('CSFloat connected · 2 to review')).toBeInTheDocument();
    expect(screen.getByText('Fast up to 7 d · stuck above 21 d')).toBeInTheDocument();
    expect(screen.getByText('Dark · English · $')).toBeInTheDocument();
    expect(await screen.findByText('v2.0.0')).toBeInTheDocument();
    expect(await screen.findByText('Backups folder ready')).toBeInTheDocument();
    expect(await screen.findByText(/1,234 items · updated/)).toBeInTheDocument();
  });

  test('o padrão é Preferências; clicar numa aba troca o painel e grava o hash sem recarregar', async () => {
    renderIndex();
    expect(screen.getByText('section-preferences')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Backup/ }));
    expect(screen.getByText('section-backup')).toBeInTheDocument();
    expect(screen.queryByText('section-preferences')).toBeNull();
    expect(window.location.hash).toBe('#backup');
  });

  test('o hash abre a aba certa ao montar', async () => {
    window.location.hash = '#aging';
    renderIndex();
    expect(await screen.findByText('section-aging')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Turnover limits/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('#csfloat (links antigos) abre Integrações e rola até o cartão do CSFloat', async () => {
    const scroll = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scroll;
    window.location.hash = '#csfloat';
    renderIndex();
    expect(await screen.findByText('section-integrations')).toBeInTheDocument();
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(screen.getByRole('tab', { name: /Integrations/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('mudar o hash com a tela aberta troca a aba (link interno)', async () => {
    renderIndex();
    window.location.hash = '#catalog';
    expect(await screen.findByText('section-catalog')).toBeInTheDocument();
  });

  test('o índice é vertical na janela larga e horizontal na estreita', () => {
    renderIndex();
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
    cleanup();
    setViewport(1000, 700);
    renderIndex();
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'horizontal');
  });

  test('o teclado percorre o índice: seta para baixo seleciona a próxima seção', async () => {
    renderIndex();
    screen.getByRole('tab', { name: /Preferences/ }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: /Exchange rates/ })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('section-fx')).toBeInTheDocument();
  });
});
