// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { UpdatePhase, UpdateState } from '@/lib/desktop';
import { loadMessages, renderUi } from '@/test/renderUi';
import type { Language } from '@/types/api';
import UpdateModal from './UpdateModal';

// QA da 12.10 parte 3: textos em de/ru/ja, "nunca instala sem o clique", progresso nos limites e movimento reduzido.
afterEach(cleanup);

const stateOf = (phase: UpdatePhase, extra: Partial<UpdateState> = {}): UpdateState => ({
  seq: 4, phase, mode: 'installer', version: '1.1.0', currentVersion: '1.0.0', notes: '<!-- en -->\n## What\n- item', percent: null, error: null, ...extra,
});

async function mount(state: UpdateState, language: Language) {
  const messages = await loadMessages(language);
  const onAction = vi.fn();
  const onHide = vi.fn();
  renderUi(<UpdateModal state={state} language={language} busy={false} onAction={onAction} onHide={onHide} />, { language, messages });
  return { onAction, onHide, messages };
}

const dialog = () => screen.getByRole('dialog');
const footerLabels = () => within(dialog().querySelector('footer') as HTMLElement).queryAllByRole('button').map((b) => b.textContent?.trim());

describe('UpdateModal em de/ru/ja', () => {
  test.each(['de', 'ru', 'ja'] as const)('%s: título, versões, botões e progresso vêm do dicionário do idioma', async (language) => {
    const { messages } = await mount(stateOf('available'), language);
    const d = (messages as unknown as { desktopUpdate: Record<string, string> }).desktopUpdate;
    expect(screen.getByRole('dialog', { name: d.availableTitle })).toBeInTheDocument();
    expect(dialog()).toHaveTextContent('1.0.0 → 1.1.0');
    expect(footerLabels()).toHaveLength(2);
    expect(footerLabels().every((label) => !!label && !/desktopUpdate\./.test(label))).toBe(true);
    // O texto não pode ser o inglês copiado (o idioma está de fato carregado).
    expect(d.availableTitle).not.toBe('Update available');
  });

  test.each(['de', 'ru', 'ja'] as const)('%s: barra de progresso tem nome acessível traduzido e valor', async (language) => {
    await mount(stateOf('downloading', { percent: 55 }), language);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '55');
    expect(bar.getAttribute('aria-label') ?? '').not.toBe('');
    expect(bar.getAttribute('aria-label')).not.toBe('Downloading the update');
  });

  test.each(['de', 'ru', 'ja'] as const)('%s: erro de download e de instalação mostram o alerta traduzido', async (language) => {
    for (const kind of ['download', 'install'] as const) {
      const { messages } = await mount(stateOf('error', { error: { kind, detail: 'boom' } }), language);
      const d = (messages as unknown as { desktopUpdate: Record<string, string> }).desktopUpdate;
      expect(screen.getByRole('alert').textContent?.length).toBeGreaterThan(5);
      expect(document.body.textContent).not.toMatch(/desktopUpdate\./);
      expect(Object.values(d).length).toBeGreaterThan(15);
      cleanup();
    }
  });
});

describe('UpdateModal: nunca instala sem o clique em instalar', () => {
  test.each(['available', 'portable-available', 'downloading', 'ready', 'installing', 'error'] as const)('%s: Esc, X e clique fora jamais enviam download/restart/installOnQuit', async (phase) => {
    const { onAction } = await mount(stateOf(phase, { error: { kind: 'download', detail: '' } }), 'en');
    await userEvent.keyboard('{Escape}');
    const close = within(dialog()).queryAllByRole('button', { name: 'Close' })[0];
    if (close && !(close as HTMLButtonElement).disabled) await userEvent.click(close);
    for (const [action] of onAction.mock.calls) expect(['download', 'restart', 'installOnQuit', 'openDownloadPage']).not.toContain(action);
  });

  test('montar o modal em qualquer fase não envia ação sozinho', async () => {
    for (const phase of ['available', 'ready', 'error', 'downloading'] as const) {
      const { onAction, onHide } = await mount(stateOf(phase, { error: { kind: 'install', detail: '' } }), 'en');
      expect(onAction).not.toHaveBeenCalled();
      expect(onHide).not.toHaveBeenCalled();
      cleanup();
    }
  });
});

describe('UpdateModal: progresso nos limites', () => {
  test.each([-5, 150, Number.NaN])('percentual fora do intervalo (%s) não quebra o modal', async (percent) => {
    await mount(stateOf('downloading', { percent }), 'en');
    const bar = screen.getByRole('progressbar');
    const now = bar.getAttribute('aria-valuenow');
    if (now !== null) {
      expect(Number(now)).toBeGreaterThanOrEqual(0);
      expect(Number(now)).toBeLessThanOrEqual(100);
    }
  });
});

describe('movimento reduzido', () => {
  test('o CSS desliga a animação da barra e a transição sob prefers-reduced-motion', () => {
    const css = readFileSync(join(__dirname, 'UpdateModal.module.css'), 'utf8');
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/\.indeterminate \.progressFill\s*\{[^}]*animation:\s*none/);
    expect(block).toMatch(/\.progressFill\s*\{[^}]*transition:\s*none/);
  });
});
