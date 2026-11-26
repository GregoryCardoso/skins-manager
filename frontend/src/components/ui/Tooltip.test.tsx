// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { renderUi } from '@/test/renderUi';
import Tooltip from './Tooltip';

afterEach(cleanup);

describe('Tooltip', () => {
  test('abre no foco e fecha com Esc', async () => {
    renderUi(
      <Tooltip content="More info">
        <button type="button">Target</button>
      </Tooltip>,
    );
    await userEvent.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('More info');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  test('não fica aberto sem foco nem hover', () => {
    renderUi(
      <Tooltip content="More info">
        <button type="button">Target</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
