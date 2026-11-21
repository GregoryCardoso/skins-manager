import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import type { CatalogStatus } from '@/types/api';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('next/link', () => ({
  default: (props: { href: string; children?: unknown }) => createElement('a', { href: props.href }, props.children as never),
}));
vi.mock('@/i18n/I18nProvider', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
  useLanguage: () => 'pt-BR',
}));
vi.mock('./HeaderControls', () => ({ default: () => createElement('div', { 'data-testid': 'header-controls' }) }));

import AppHeader from './AppHeader';
import { CatalogSummary } from './CatalogSettings';

describe('AppHeader', () => {
  const html = renderToStaticMarkup(createElement(AppHeader));

  test('mantém o menu e os controles de tema e idioma', () => {
    for (const key of ['nav.inventory', 'nav.sales', 'nav.stores', 'nav.settings']) expect(html).toContain(key);
    expect(html).toContain('header-controls');
  });

  test('não renderiza cotação nem status do sistema', () => {
    expect(html).not.toMatch(/fx\.|US\$|statusIndicator|status\.|catalog/i);
    expect(html).not.toContain('role="dialog"');
  });
});

describe('CatalogSummary', () => {
  const status: CatalogStatus = {
    total: 12345,
    countsBySource: { SKINS: 10, STICKERS: 2, CRATES: 1, KEYCHAINS: 0, AGENTS: 0 },
    catalogUpdatedAt: null,
  } as CatalogStatus;

  test('mostra o total do catálogo formatado', () => {
    const html = renderToStaticMarkup(createElement(CatalogSummary, { status }));
    expect(html).toContain('catalog.total');
    expect(html).toContain('12.345');
    expect(html).toContain('catalog.neverUpdated');
  });
});
