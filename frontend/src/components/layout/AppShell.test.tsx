// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderUi, setViewport } from '@/test/renderUi';
import AppShell from './AppShell';

const state = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));
vi.mock('@/components/PreferencesProvider', () => ({
  usePreferences: () => ({
    theme: 'LIGHT', language: 'en', displayCurrency: 'USD', fxRates: [], requiredFxCurrencies: [], saveError: null,
    setTheme: () => {}, setLanguage: () => {}, reloadFxRate: () => {},
  }),
}));
vi.mock('@/components/CurrencyChangeModal', () => ({ default: () => null }));
vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ displayCurrency: 'USD', fxRates: [], requiredFxCurrencies: [] })),
    getCsfloatIntegration: vi.fn(async () => ({ openEntriesCount: 0, importInProgress: false, lastImportAt: null })),
    getHealth: vi.fn(async () => ({ status: 'ok', timestamp: '2026-11-26T12:00:00.000Z', version: '1.4.0' })),
  };
});

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderUi(
    <AppShell>
      <p>Page body</p>
    </AppShell>,
    { client, withToast: true },
  );
}

const root = () => document.querySelector('[data-nav]') as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-nav-collapsed');
  setViewport(1440, 900);
  state.pathname = '/';
});
afterEach(cleanup);

describe('AppShell: estrutura e "pular para o conteúdo"', () => {
  test('o primeiro Tab foca "Skip to content" e Enter leva o foco ao main', async () => {
    renderShell();
    await userEvent.tab();
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const main = document.getElementById('main-content');
    expect(main?.tagName).toBe('MAIN');
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(main).toHaveFocus();
  });

  test('a página fica dentro do main, ao lado do menu', async () => {
    renderShell();
    expect(screen.getByRole('main')).toContainElement(screen.getByText('Page body'));
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(root()).toHaveAttribute('data-nav', 'expanded');
  });
});

describe('AppShell: recolher e expandir (faixa larga)', () => {
  test('recolhe, grava sm.navCollapsed e o atributo do <html>; expande e desfaz', async () => {
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse menu' }));
    expect(root()).toHaveAttribute('data-nav', 'collapsed');
    expect(localStorage.getItem('sm.navCollapsed')).toBe('1');
    expect(document.documentElement.getAttribute('data-nav-collapsed')).toBe('1');
    await userEvent.click(screen.getByRole('button', { name: 'Expand menu' }));
    expect(root()).toHaveAttribute('data-nav', 'expanded');
    expect(localStorage.getItem('sm.navCollapsed')).toBe('0');
    expect(document.documentElement.hasAttribute('data-nav-collapsed')).toBe(false);
  });

  test('a preferência gravada abre o menu recolhido', async () => {
    localStorage.setItem('sm.navCollapsed', '1');
    renderShell();
    await waitFor(() => expect(root()).toHaveAttribute('data-nav', 'collapsed'));
  });
});

describe('AppShell: faixa estreita (menu por cima do conteúdo)', () => {
  beforeEach(() => setViewport(1000, 800));

  test('abaixo de 1100 px o menu é sempre recolhido, mesmo sem preferência', () => {
    renderShell();
    expect(root()).toHaveAttribute('data-nav', 'collapsed');
  });

  test('expandir abre por cima (overlay) sem mudar a preferência; Esc fecha e devolve o foco ao botão', async () => {
    renderShell();
    const expand = screen.getByRole('button', { name: 'Expand menu' });
    await userEvent.click(expand);
    expect(root()).toHaveAttribute('data-nav', 'overlay');
    expect(await screen.findByRole('dialog', { name: 'Main navigation' })).toBeInTheDocument();
    expect(localStorage.getItem('sm.navCollapsed')).toBeNull();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(root()).toHaveAttribute('data-nav', 'collapsed'));
    expect(screen.queryByRole('dialog', { name: 'Main navigation' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Expand menu' })).toHaveFocus());
  });

  test('navegar (mudar a rota) fecha o menu aberto por cima', async () => {
    const view = renderShell();
    await userEvent.click(screen.getByRole('button', { name: 'Expand menu' }));
    expect(root()).toHaveAttribute('data-nav', 'overlay');
    state.pathname = '/sales/';
    view.rerender(
      <AppShell>
        <p>Page body</p>
      </AppShell>,
    );
    await waitFor(() => expect(root()).toHaveAttribute('data-nav', 'collapsed'));
  });
});
