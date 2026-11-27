// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderUi } from '@/test/renderUi';

// Marca o que passou pelo roteador do Next (next/link) e o que ficou como <a> simples.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} data-next-link="true" {...rest}>{children}</a>
  ),
}));

import Menu from './Menu';

afterEach(cleanup);

async function open(items: React.ComponentProps<typeof Menu>['items']) {
  const user = userEvent.setup();
  renderUi(<Menu items={items} label="More" />);
  await user.click(screen.getByRole('button', { name: 'More' }));
  return screen.findByRole('menu');
}

describe('Menu com href', () => {
  test('caminho do próprio app usa next/link (sem recarregar a página)', async () => {
    await open([{ type: 'item', id: 'a', label: 'Cutoff', href: '/imports/#cutoff' }]);
    const item = screen.getByRole('menuitem', { name: 'Cutoff' });
    expect(item).toHaveAttribute('href', '/imports/#cutoff');
    expect(item).toHaveAttribute('data-next-link', 'true');
  });

  test('endereço externo e steam: continuam <a> simples com rel seguro', async () => {
    await open([
      { type: 'item', id: 'b', label: 'Web', href: 'https://csfloat.com/x', external: true },
      { type: 'item', id: 'c', label: 'Steam', href: 'steam://rungame/730' },
    ]);
    const web = screen.getByRole('menuitem', { name: 'Web' });
    expect(web).not.toHaveAttribute('data-next-link');
    expect(web).toHaveAttribute('target', '_blank');
    expect(web).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('menuitem', { name: 'Steam' })).not.toHaveAttribute('data-next-link');
  });
});
