// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { renderUi } from '@/test/renderUi';
import Spinner from './Spinner';

afterEach(cleanup);

describe('Spinner', () => {
  test('role=status com o texto padrão (common.loading)', () => {
    renderUi(<Spinner />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
  });

  test('rótulo próprio', () => {
    renderUi(<Spinner label="Fetching prices" size="sm" />);
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Fetching prices');
  });
});
