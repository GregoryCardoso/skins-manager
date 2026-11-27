import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import type { CatalogStatus } from '@/types/api';

vi.mock('@/i18n/I18nProvider', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
  useLanguage: () => 'pt-BR',
  useLocale: () => 'pt-BR',
}));

import { CatalogSummary } from './CatalogSettings';

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
