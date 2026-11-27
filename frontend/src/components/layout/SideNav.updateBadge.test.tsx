// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { UpdateState } from '@/lib/desktop';
import { clearUpdateUi, publishUpdateUi } from '@/lib/updateUiStore';
import { renderUi, setViewport } from '@/test/renderUi';
import SideNav from './SideNav';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/components/PreferencesProvider', () => ({
  usePreferences: () => ({ theme: 'LIGHT', language: 'en', displayCurrency: 'USD', saveError: null, setTheme: () => {}, setLanguage: () => {} }),
}));
vi.mock('@/components/CurrencyChangeModal', () => ({ default: () => null }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ show: () => 0 }) }));
vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { ...actual, getCsfloatIntegration: vi.fn(async () => ({ openEntriesCount: 0, importInProgress: false })) };
});

const available: UpdateState = { seq: 1, phase: 'available', mode: 'installer', version: '1.1.0', currentVersion: '1.0.0', notes: '', percent: null, error: null };

function renderNav(mode: 'expanded' | 'collapsed') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderUi(<SideNav mode={mode} short={false} onToggle={() => {}} onCloseOverlay={() => {}} />, { client });
}

beforeEach(() => setViewport(1440, 900));
afterEach(() => {
  cleanup();
  clearUpdateUi();
});

describe('SideNav: selo "Atualização disponível"', () => {
  test('sem atualização (ou no navegador) o menu não tem o selo', () => {
    renderNav('expanded');
    expect(screen.queryByRole('button', { name: 'Update available' })).toBeNull();
  });

  test.each(['expanded', 'collapsed'] as const)('com atualização disponível, o selo aparece no menu %s com nome acessível', (mode) => {
    renderNav(mode);
    act(() => publishUpdateUi({ state: available, hidden: false }));
    const badge = screen.getByRole('button', { name: 'Update available' });
    expect(badge).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toContainElement(badge);
  });

  test('o selo acompanha a fase: baixando com a porcentagem e some em erro', () => {
    renderNav('expanded');
    act(() => publishUpdateUi({ state: { ...available, phase: 'downloading', percent: 64, seq: 2 }, hidden: true }));
    expect(screen.getByRole('button', { name: 'Downloading the update 64%' })).toBeInTheDocument();
    act(() => publishUpdateUi({ state: { ...available, phase: 'error', error: { kind: 'download', detail: '' }, seq: 3 }, hidden: false }));
    expect(screen.queryByRole('button', { name: /Downloading|Update/ })).toBeNull();
  });
});
