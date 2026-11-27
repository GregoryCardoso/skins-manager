// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { UpdateState } from '@/lib/desktop';
import { clearUpdateUi, onUpdateReopen, publishUpdateUi } from '@/lib/updateUiStore';
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

const base: UpdateState = { seq: 1, phase: 'available', mode: 'installer', version: '1.1.0', currentVersion: '1.0.0', notes: '', percent: null, error: null };

function renderNav(mode: 'expanded' | 'collapsed' | 'overlay') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderUi(<SideNav mode={mode} short={false} onToggle={() => {}} onCloseOverlay={() => {}} />, { client });
}

beforeEach(() => setViewport(1440, 900));
afterEach(() => {
  cleanup();
  clearUpdateUi();
});

describe('selo no menu: casos extras', () => {
  test.each(['idle', 'installing', 'error'] as const)('fase %s: sem selo no menu', (phase) => {
    renderNav('expanded');
    act(() => publishUpdateUi({ state: { ...base, phase, error: { kind: 'download', detail: '' } }, hidden: false }));
    expect(screen.queryByRole('button', { name: /update|download/i })).toBeNull();
  });

  test('menu recolhido: o selo tem nome acessível único e o Tooltip abre com o mesmo texto ao focar', async () => {
    renderNav('collapsed');
    act(() => publishUpdateUi({ state: { ...base, phase: 'downloading', percent: 12, seq: 2 }, hidden: true }));
    const badges = screen.getAllByRole('button', { name: 'Downloading the update 12%' });
    expect(badges).toHaveLength(1);
    await act(async () => badges[0].focus());
    expect((await screen.findAllByText('Downloading the update 12%')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Downloading the update 12%');
  });

  test('menu por cima (overlay): só um selo acessível, dentro do painel, e clicar reabre o modal', async () => {
    renderNav('overlay');
    act(() => publishUpdateUi({ state: { ...base, phase: 'ready', seq: 3 }, hidden: true }));
    // A coluna fica aria-hidden atrás do painel: o leitor de tela vê um selo só.
    const accessible = screen.getAllByRole('button', { name: 'Update ready' });
    expect(accessible).toHaveLength(1);
    expect(within(screen.getByTestId('side-nav-overlay')).getByRole('button', { name: 'Update ready' })).toBe(accessible[0]);
    const reopen = vi.fn();
    const off = onUpdateReopen(reopen);
    await userEvent.click(accessible[0]);
    expect(reopen).toHaveBeenCalledTimes(1);
    off();
  });

  test('o selo reabre o modal escondido em downloading e em ready (pedido de reabrir disparado)', async () => {
    renderNav('expanded');
    const reopen = vi.fn();
    const off = onUpdateReopen(reopen);
    act(() => publishUpdateUi({ state: { ...base, phase: 'downloading', percent: 3, seq: 5 }, hidden: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Downloading the update 3%' }));
    act(() => publishUpdateUi({ state: { ...base, phase: 'ready', seq: 6 }, hidden: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Update ready' }));
    expect(reopen).toHaveBeenCalledTimes(2);
    off();
  });
});
