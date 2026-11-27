// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { renderUi } from '@/test/renderUi';
import NotFound from './not-found';

afterEach(cleanup);

test('404 (12.4): título da aba, estado vazio com o texto e o link de volta ao início', () => {
  renderUi(<NotFound />);
  expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  expect(document.title).toBe('Page not found · Skins Manager');
  expect(screen.getByText('This page does not exist. Use the menu to go back.')).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'Back to inventory' });
  expect(link.getAttribute('href')).toBe('/');
});
