// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/i18n/I18nProvider', () => ({
  useT: () => (key: string) => (key === 'common.logoAlt' ? 'Logo traduzido' : key),
}));

import Logo from './Logo';

afterEach(cleanup);

describe('Logo (infra de testes de componente, 12.2)', () => {
  test('expõe o rótulo traduzido como imagem acessível', () => {
    render(<Logo size={40} />);
    const img = screen.getByRole('img', { name: 'Logo traduzido' });
    expect(img).toHaveAttribute('width', '40');
  });

  test('duas instâncias não repetem os ids dos gradientes', () => {
    const { container } = render(
      <>
        <Logo />
        <Logo />
      </>,
    );
    const ids = Array.from(container.querySelectorAll('[id]')).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
