// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { loadMessages, renderUi, setViewport } from '@/test/renderUi';
import SideNav from './SideNav';

const state = vi.hoisted(() => ({ pathname: '/', openEntries: 0 as number | 'error' }));

vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));
vi.mock('@/components/PreferencesProvider', () => ({
  usePreferences: () => ({ theme: 'LIGHT', language: 'en', displayCurrency: 'USD', saveError: null, setTheme: () => {}, setLanguage: () => {} }),
}));
vi.mock('@/components/CurrencyChangeModal', () => ({ default: () => null }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ show: () => 0 }) }));
vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    getCsfloatIntegration: vi.fn(async () => {
      if (state.openEntries === 'error') throw new actual.ApiRequestError('NETWORK_ERROR', 'x', 0);
      return { openEntriesCount: state.openEntries, importInProgress: false };
    }),
  };
});

function renderNav(props: Partial<React.ComponentProps<typeof SideNav>> = {}, options: Parameters<typeof renderUi>[1] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onToggle = vi.fn();
  const onCloseOverlay = vi.fn();
  const view = renderUi(<SideNav mode="expanded" short={false} onToggle={onToggle} onCloseOverlay={onCloseOverlay} {...props} />, { client, ...options });
  return { ...view, onToggle, onCloseOverlay };
}

beforeEach(() => {
  setViewport(1440, 900);
  state.pathname = '/';
  state.openEntries = 0;
});
afterEach(cleanup);

describe('SideNav: itens e rota ativa', () => {
  test('tem os cinco itens e Configurações, com Importações presente', () => {
    renderNav();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    const hrefs = ['Inventory', 'Sales', 'Real profit', 'Stores', 'Imports', 'Settings'].map((name) => (screen.getByRole('link', { name }).getAttribute('href') ?? '').replace(/(.)\/$/, '$1'));
    // O next/link do teste não aplica o trailingSlash do next.config; a barra final é conferida em routes.test.ts.
    expect(hrefs).toEqual(['/', '/sales', '/profit', '/stores', '/imports', '/settings']);
  });

  test.each([
    ['/', 'Inventory'],
    ['/sales/', 'Sales'],
    ['/profit', 'Real profit'],
    ['/stores/', 'Stores'],
    ['/imports/', 'Imports'],
    ['/settings/', 'Settings'],
  ])('em %s só o item %s tem aria-current="page"', (pathname, name) => {
    state.pathname = pathname;
    renderNav();
    const current = screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(name);
  });

  test('caminho desconhecido (404) não marca nenhum item', () => {
    state.pathname = '/nada/';
    renderNav();
    expect(screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')).toHaveLength(0);
  });

  test.each([
    ['de', ['Inventar', 'Verkäufe', 'Echter Gewinn', 'Shops', 'Importe', 'Einstellungen']],
    ['ja', ['インベントリ', '販売', '実利益', 'ストア', 'インポート', '設定']],
  ] as const)('os nomes vêm do idioma (%s)', async (language, names) => {
    const messages = await loadMessages(language);
    renderNav({}, { language, messages });
    for (const name of names) expect(screen.getByRole('link', { name })).toBeInTheDocument();
  });
});

describe('SideNav: selo "Para conferir"', () => {
  test('com 0 ou com erro na consulta, não mostra nada', async () => {
    state.openEntries = 0;
    const { unmount } = renderNav();
    await waitFor(() => expect(screen.getByRole('link', { name: 'Imports' })).toBeInTheDocument());
    expect(screen.queryByText(/to review/)).toBeNull();
    unmount();
    state.openEntries = 'error';
    renderNav();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole('link', { name: 'Imports' })).toBeInTheDocument();
    expect(screen.queryByText(/to review/)).toBeNull();
  });

  test('com 3, o número aparece e o nome do link inclui "3 to review"', async () => {
    state.openEntries = 3;
    renderNav();
    expect(await screen.findByRole('link', { name: /Imports\s+3 to review/ })).toBeInTheDocument();
    expect(screen.getByText('3')).toHaveAttribute('aria-hidden', 'true');
  });

  test('com 150, mostra 99+ e o nome continua com a contagem exata', async () => {
    state.openEntries = 150;
    renderNav();
    expect(await screen.findByRole('link', { name: /Imports\s+150 to review/ })).toBeInTheDocument();
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  test.each([
    ['pt-BR', 1, '1 para conferir'],
    ['pt-BR', 2, '2 para conferir'],
    ['pt-BR', 5, '5 para conferir'],
    ['ru', 1, '1 на проверку'],
    ['ru', 2, '2 на проверку'],
    ['ru', 5, '5 на проверку'],
    ['pl', 1, '1 do sprawdzenia'],
    ['pl', 2, '2 do sprawdzenia'],
    ['pl', 5, '5 do sprawdzenia'],
  ] as const)('plural em %s com %i', async (language, count, expected) => {
    state.openEntries = count;
    const messages = await loadMessages(language);
    renderNav({}, { language, messages });
    const link = await waitFor(() => {
      const found = screen.getAllByRole('link').find((entry) => entry.getAttribute('data-nav-id') === 'imports');
      expect(found?.textContent).toContain(expected);
      return found as HTMLElement;
    });
    expect(link).toHaveAccessibleName(new RegExp(expected));
  });
});

describe('SideNav: recolhido', () => {
  test('cada link mantém o nome acessível e o Tooltip abre no foco, com o nome e a contagem', async () => {
    state.openEntries = 3;
    renderNav({ mode: 'collapsed' });
    expect(await screen.findByRole('link', { name: /Imports\s+3 to review/ })).toBeInTheDocument();
    for (const name of ['Inventory', 'Sales', 'Real profit', 'Stores', 'Settings']) expect(screen.getByRole('link', { name })).toBeInTheDocument();
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Inventory' })).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Inventory');
  });

  test('o botão de expandir diz "Expand menu", com aria-expanded=false e aria-controls', async () => {
    const { onToggle } = renderNav({ mode: 'collapsed' });
    const button = screen.getByRole('button', { name: 'Expand menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'side-nav');
    expect(document.getElementById('side-nav')).not.toBeNull();
    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  test('expandido, o botão diz "Collapse menu" com aria-expanded=true', () => {
    renderNav({ mode: 'expanded' });
    expect(screen.getByRole('button', { name: 'Collapse menu' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('rodapé recolhido (dois botões de ícone) com janela baixa, mesmo com o menu expandido', () => {
    renderNav({ mode: 'expanded', short: true });
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByRole('button', { name: /Theme: Light/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preferences' })).toBeInTheDocument();
  });
});

describe('SideNav: por cima do conteúdo (faixa estreita)', () => {
  test('abre como diálogo com o nome do menu, tem os itens, e Esc pede para fechar', async () => {
    const { onCloseOverlay } = renderNav({ mode: 'overlay' });
    const dialog = await screen.findByRole('dialog', { name: 'Main navigation' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Sales' }).length).toBeGreaterThan(0);
    await userEvent.keyboard('{Escape}');
    expect(onCloseOverlay).toHaveBeenCalled();
  });

  test('auditoria 12.11: o foco inicial vai ao link da página atual (o Radix pularia os links e cairia no tema)', async () => {
    renderNav({ mode: 'overlay' });
    const dialog = await screen.findByRole('dialog', { name: 'Main navigation' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(document.activeElement?.tagName).toBe('A');
    expect(document.activeElement).toHaveAttribute('aria-current', 'page');
  });

  test('o foco fica preso dentro do painel', async () => {
    renderNav({ mode: 'overlay' });
    const dialog = await screen.findByRole('dialog', { name: 'Main navigation' });
    for (let i = 0; i < 25; i += 1) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  test('o botão dentro do painel diz "Collapse menu" e chama onToggle', async () => {
    const { onToggle } = renderNav({ mode: 'overlay' });
    const dialog = await screen.findByRole('dialog', { name: 'Main navigation' });
    const button = dialog.querySelector('button[aria-controls="side-nav"]') as HTMLButtonElement;
    expect(button).toHaveAccessibleName('Collapse menu');
    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalled();
  });
});

describe('SideNav: só pelo teclado', () => {
  test('o Tab passa por todos os itens e pelo rodapé, na ordem', async () => {
    renderNav({ mode: 'expanded' });
    const seen: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      await userEvent.tab();
      const active = document.activeElement as HTMLElement;
      seen.push(active.getAttribute('aria-label') ?? active.textContent ?? active.tagName);
    }
    const labels = seen.join('|');
    const order = ['Inventory', 'Sales', 'Real profit', 'Stores', 'Imports', 'Settings'].map((name) => labels.indexOf(name));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(labels).toContain('Collapse menu');
    expect(seen.some((entry) => entry === 'SELECT' || entry.includes('English'))).toBe(true);
  });
});
