// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import Icon, { ICONS } from './Icon';

afterEach(cleanup);

describe('Icon', () => {
  test('sem rótulo é decorativo', () => {
    const { container } = render(<Icon name="search" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  test('com rótulo vira imagem acessível', () => {
    render(<Icon name="alert" label="Atenção" size={20} />);
    const img = screen.getByRole('img', { name: 'Atenção' });
    expect(img).toHaveAttribute('width', '20');
  });

  test('todos os nomes registrados existem', () => {
    for (const name of Object.keys(ICONS)) {
      const { container, unmount } = render(<Icon name={name as keyof typeof ICONS} />);
      expect(container.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });
});
