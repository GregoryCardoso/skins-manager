// @vitest-environment jsdom
import '@/test/setupDom';
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { UpdateState } from '@/lib/desktop';
import { clearUpdateUi } from '@/lib/updateUiStore';
import { renderUi } from '@/test/renderUi';
import DesktopUpdateHost from './DesktopUpdateHost';
import UpdateBadge from './layout/UpdateBadge';

// Host + selo juntos, com a ponte do desktop falsa em `window.skinsDesktop`.
afterEach(() => {
  cleanup();
  clearUpdateUi();
  delete (window as unknown as { skinsDesktop?: unknown }).skinsDesktop;
});

const ready: UpdateState = { seq: 9, phase: 'ready', mode: 'installer', version: '1.1.0', currentVersion: '1.0.0', notes: '', percent: null, error: null };

function installBridge(initial: UpdateState) {
  const respondToUpdate = vi.fn(async () => ({ accepted: true, state: { ...initial, phase: 'idle' as const, seq: initial.seq + 1 } }));
  (window as unknown as { skinsDesktop: unknown }).skinsDesktop = {
    isDesktop: true,
    getAppInfo: vi.fn(),
    checkForUpdates: vi.fn(),
    getUpdateState: vi.fn(async () => initial),
    respondToUpdate,
    onUpdateState: vi.fn(() => () => {}),
  };
  return respondToUpdate;
}

const both = (
  <>
    <UpdateBadge compact={false} />
    <DesktopUpdateHost />
  </>
);

describe('DesktopUpdateHost + UpdateBadge', () => {
  test('esconder o modal deixa o selo; clicar no selo reabre o modal', async () => {
    const respond = installBridge(ready);
    renderUi(both);
    expect(await screen.findByRole('dialog', { name: 'Update ready' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}'); // em ready só esconde
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(respond).not.toHaveBeenCalled();
    const badge = screen.getByRole('button', { name: 'Update ready' });

    await userEvent.click(badge);
    expect(await screen.findByRole('dialog', { name: 'Update ready' })).toBeInTheDocument();
  });

  test('sem a ponte do desktop não há modal nem selo', async () => {
    renderUi(both);
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('ao desmontar o host, o selo some', async () => {
    installBridge(ready);
    const { rerender } = renderUi(both);
    await screen.findByRole('dialog');
    rerender(<UpdateBadge compact={false} />);
    expect(screen.queryByRole('button', { name: 'Update ready' })).toBeNull();
  });
});
