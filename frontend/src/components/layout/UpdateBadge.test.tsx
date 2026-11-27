// @vitest-environment jsdom
import '@/test/setupDom';
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { UpdatePhase, UpdateState } from '@/lib/desktop';
import { clearUpdateUi, onUpdateReopen, publishUpdateUi } from '@/lib/updateUiStore';
import { loadMessages, renderUi } from '@/test/renderUi';
import UpdateBadge from './UpdateBadge';

afterEach(() => {
  cleanup();
  clearUpdateUi();
});

const stateOf = (phase: UpdatePhase, extra: Partial<UpdateState> = {}): UpdateState => ({
  seq: 2, phase, mode: 'installer', version: '1.1.0', currentVersion: '1.0.0', notes: '', percent: null, error: null, ...extra,
});
const publish = (state: UpdateState | null, hidden = false) => act(() => publishUpdateUi({ state, hidden }));

describe('UpdateBadge', () => {
  test('sem estado publicado (navegador, código-fonte): não renderiza nada', () => {
    const { container } = renderUi(<UpdateBadge compact={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  test.each<[UpdatePhase, Partial<UpdateState>, string]>([
    ['available', {}, 'Update available'],
    ['portable-available', { mode: 'portable' }, 'Update available'],
    ['downloading', { percent: 37 }, 'Downloading the update 37%'],
    ['downloading', { percent: null }, 'Downloading the update'],
    ['ready', {}, 'Update ready'],
  ])('aparece em %s com o texto certo', (phase, extra, label) => {
    renderUi(<UpdateBadge compact={false} />);
    publish(stateOf(phase, extra));
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });

  test.each<UpdatePhase>(['idle', 'installing', 'error'])('não aparece em %s', (phase) => {
    renderUi(<UpdateBadge compact={false} />);
    publish(stateOf(phase, { error: { kind: 'download', detail: '' } }));
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('some quando o estado volta a nulo e acompanha as mudanças de fase', () => {
    renderUi(<UpdateBadge compact={false} />);
    publish(stateOf('available'));
    expect(screen.getByRole('button', { name: 'Update available' })).toBeInTheDocument();
    publish(stateOf('downloading', { percent: 5, seq: 3 }));
    expect(screen.getByRole('button', { name: 'Downloading the update 5%' })).toBeInTheDocument();
    publish(null);
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('recolhido: o nome acessível continua o mesmo (texto só para leitor de tela)', () => {
    renderUi(<UpdateBadge compact />);
    publish(stateOf('available'));
    expect(screen.getByRole('button', { name: 'Update available' })).toBeInTheDocument();
  });

  test('clicar pede para reabrir o modal escondido', async () => {
    const reopen = vi.fn();
    const off = onUpdateReopen(reopen);
    renderUi(<UpdateBadge compact={false} />);
    publish(stateOf('ready'), true);
    await userEvent.click(screen.getByRole('button', { name: 'Update ready' }));
    expect(reopen).toHaveBeenCalledTimes(1);
    off();
  });

  test('textos nos idiomas (pt-BR e ja)', async () => {
    for (const [language, label] of [['pt-BR', 'Atualização disponível'], ['ja', '更新があります']] as const) {
      const messages = await loadMessages(language);
      const { unmount } = renderUi(<UpdateBadge compact={false} />, { language, messages });
      publish(stateOf('available'));
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      unmount();
    }
  });
});
