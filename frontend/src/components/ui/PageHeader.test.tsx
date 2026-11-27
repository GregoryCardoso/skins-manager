// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { loadMessages, renderUi } from '@/test/renderUi';
import PageHeader from './PageHeader';

afterEach(cleanup);

describe('PageHeader (12.4)', () => {
  test('um h1 com o título, o subtítulo e as ações', () => {
    renderUi(<PageHeader title="Sales" subtitle="3 sales" actions={<button type="button">Import</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Sales' })).toBeInTheDocument();
    expect(screen.getByText('3 sales')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument();
  });

  test('é a única fonte do título da aba: "Sales · Skins Manager" em inglês', () => {
    renderUi(<PageHeader title="Sales" />);
    expect(document.title).toBe('Sales · Skins Manager');
  });

  test.each([
    ['de', 'Verkäufe'],
    ['ja', '販売'],
  ] as const)('o título da aba segue o idioma (%s)', async (language, title) => {
    const messages = await loadMessages(language);
    renderUi(<PageHeader title={title} />, { language, messages });
    expect(document.title).toBe(`${title} · Skins Manager`);
  });

  test('o título da aba acompanha a troca do título da página', () => {
    const { rerender } = renderUi(<PageHeader title="Stores" />);
    expect(document.title).toBe('Stores · Skins Manager');
    rerender(<PageHeader title="Settings" />);
    expect(document.title).toBe('Settings · Skins Manager');
  });
  test('ao desmontar, devolve o título anterior da aba', () => {
    document.title = 'Before';
    const { unmount } = renderUi(<PageHeader title="Stores" />);
    expect(document.title).toBe('Stores · Skins Manager');
    unmount();
    expect(document.title).toBe('Before');
  });

  test('o subtítulo vivo é anunciado com educação; o fixo não', () => {
    const { rerender } = renderUi(<PageHeader title="Inventory" subtitle="14 items" liveSubtitle />);
    expect(screen.getByText('14 items')).toHaveAttribute('aria-live', 'polite');
    rerender(<PageHeader title="Inventory" subtitle="14 items" />);
    expect(screen.getByText('14 items')).not.toHaveAttribute('aria-live');
  });

  test('sem ações nem subtítulo, não cria contêineres vazios; o h1 aceita foco por código', () => {
    const { container } = renderUi(<PageHeader title="Stores" headingId="x" />);
    expect(container.querySelectorAll('header > div')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('id', 'x');
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('tabindex', '-1');
  });
});
