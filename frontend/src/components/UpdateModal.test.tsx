// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { UPDATE_PHASES, type UpdateAction, type UpdatePhase, type UpdateState } from '@/lib/desktop';
import { loadMessages, renderUi } from '@/test/renderUi';
import UpdateModal, { closeActionFor, isModalHidden } from './UpdateModal';

afterEach(cleanup);

const NOTES = '<!-- pt-BR -->\n## Novidades\n- **Modal** novo\n\n<!-- en -->\n## What is new\n- **New** dialog';

function stateOf(phase: UpdatePhase, extra: Partial<UpdateState> = {}): UpdateState {
  return { seq: 4, phase, mode: 'installer', version: '1.1.0', currentVersion: '1.0.0', notes: NOTES, percent: null, error: null, ...extra };
}

function setup(state: UpdateState, { language = 'en', busy = false }: { language?: 'en' | 'pt-BR'; busy?: boolean } = {}) {
  const onAction = vi.fn();
  const onHide = vi.fn();
  const view = renderUi(<UpdateModal state={state} language={language} busy={busy} onAction={onAction} onHide={onHide} />);
  return { ...view, onAction, onHide };
}

const dialog = () => screen.getByRole('dialog');
const footer = () => within(dialog().querySelector('footer') as HTMLElement);
const footerButtons = () => {
  const node = dialog().querySelector('footer');
  return node ? within(node).queryAllByRole('button').map((b) => b.textContent?.trim()) : [];
};

describe('closeActionFor e isModalHidden (D190 e V102-Q2, inalterados)', () => {
  test('uma escolha por fase; em ready o X/Esc nunca instala', () => {
    expect(closeActionFor('available')).toBe('later');
    expect(closeActionFor('portable-available')).toBe('dismiss');
    expect(closeActionFor('error')).toBe('dismiss');
    expect(closeActionFor('downloading')).toBe('hide');
    expect(closeActionFor('ready')).toBe('hide');
    expect(closeActionFor('installing')).toBeNull();
    expect(closeActionFor('idle')).toBeNull();
    expect(closeActionFor('qualquer' as UpdatePhase)).toBeNull();
    for (const phase of UPDATE_PHASES) expect(closeActionFor(phase)).not.toBe('installOnQuit');
  });

  test('isModalHidden: ready vale só para o mesmo seq; downloading vale enquanto a fase for a mesma', () => {
    expect(isModalHidden(null, stateOf('ready'))).toBe(false);
    const ready = { phase: 'ready' as const, seq: 4 };
    expect(isModalHidden(ready, stateOf('ready', { seq: 4 }))).toBe(true);
    expect(isModalHidden(ready, stateOf('ready', { seq: 5 }))).toBe(false);
    const downloading = { phase: 'downloading' as const, seq: 7 };
    expect(isModalHidden(downloading, stateOf('downloading', { seq: 30, percent: 80 }))).toBe(true);
    expect(isModalHidden(downloading, stateOf('ready', { seq: 31 }))).toBe(false);
  });
});

describe('UpdateModal: conteúdo por fase', () => {
  test('available: versões em destaque, frase de confirmação, notas abertas no idioma e os dois caminhos', () => {
    setup(stateOf('available'));
    expect(screen.getByRole('dialog', { name: 'Update available' })).toBeInTheDocument();
    expect(dialog()).toHaveTextContent('Version 1.1.0 is available. You are on 1.0.0.');
    expect(dialog()).toHaveTextContent('1.0.0 → 1.1.0');
    expect(dialog()).toHaveTextContent('Nothing is downloaded or installed unless you confirm');
    expect(screen.getByRole('button', { name: 'What is new' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog()).getByText('New')).toBeInTheDocument();
    expect(dialog()).not.toHaveTextContent('Novidades');
    expect(footerButtons()).toEqual(['Not now', 'Download and install']);
  });

  test('available em pt-BR: notas em pt-BR (o idioma das notas vem da prop language)', async () => {
    const messages = await loadMessages('pt-BR');
    renderUi(<UpdateModal state={stateOf('available')} language="pt-BR" busy={false} onAction={() => {}} onHide={() => {}} />, { language: 'pt-BR', messages });
    expect(dialog()).toHaveTextContent('A versão 1.1.0 está disponível. Você está na 1.0.0.');
    expect(within(dialog()).getByText('Modal')).toBeInTheDocument();
    expect(dialog()).not.toHaveTextContent('What is new');
    expect(footerButtons()).toEqual(['Agora não', 'Baixar e instalar']);
  });

  test('available sem notas: avisa que não há notas', () => {
    setup(stateOf('available', { notes: '' }));
    expect(dialog()).toHaveTextContent('This version has no release notes.');
  });

  test('portable-available: sem "Download and install", com a página de download', () => {
    setup(stateOf('portable-available', { mode: 'portable' }));
    expect(dialog()).toHaveTextContent('The portable version does not update itself');
    expect(dialog()).not.toHaveTextContent('Nothing is downloaded or installed');
    expect(footerButtons()).toEqual(['Not now', 'Open download page']);
  });

  test('downloading: barra com aria-valuenow, porcentagem, aviso e só "Keep using the app"', () => {
    setup(stateOf('downloading', { percent: 42 }));
    const bar = screen.getByRole('progressbar', { name: 'Downloading the update' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(dialog()).toHaveTextContent('42%');
    expect(dialog()).toHaveTextContent('Downloading version 1.1.0...');
    expect(footerButtons()).toEqual(['Keep using the app']);
  });

  test('downloading sem percentual: barra indeterminada (sem aria-valuenow) e sem %', () => {
    setup(stateOf('downloading', { percent: null }));
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(dialog()).not.toHaveTextContent('%');
  });

  test('downloading com 0 e 100 mostra a porcentagem', () => {
    const { unmount } = setup(stateOf('downloading', { percent: 0 }));
    expect(dialog()).toHaveTextContent('0%');
    unmount();
    setup(stateOf('downloading', { percent: 100 }));
    expect(dialog()).toHaveTextContent('100%');
  });

  test('ready: textos, a regra de V102-Q2 e os dois caminhos; sem notas', () => {
    setup(stateOf('ready'));
    expect(screen.getByRole('dialog', { name: 'Update ready' })).toBeInTheDocument();
    expect(dialog()).toHaveTextContent('Version 1.1.0 was downloaded and is ready to install.');
    expect(dialog()).toHaveTextContent('nothing is installed now');
    expect(footerButtons()).toEqual(['Install when closing the app', 'Restart and install']);
    expect(dialog()).not.toHaveTextContent('What is new');
  });

  test('installing: sem botões de ação, com status', () => {
    setup(stateOf('installing'));
    expect(screen.getByRole('status')).toHaveTextContent('Restarting to install...');
    expect(footerButtons()).toEqual([]);
  });

  test('error de download: alerta, detalhe só em texto (recolhido até abrir) e "Close"', async () => {
    setup(stateOf('error', { error: { kind: 'download', detail: 'disco <b>cheio</b><img src=x onerror=alert(1)>' } }));
    expect(screen.getByRole('alert')).toHaveTextContent('The update could not be downloaded.');
    await userEvent.click(screen.getByRole('button', { name: 'Technical details' }));
    expect(dialog()).toHaveTextContent('disco <b>cheio</b><img src=x onerror=alert(1)>');
    expect(dialog().querySelector('img')).toBeNull();
    expect(dialog().querySelector('b')).toBeNull();
    expect(footerButtons()).toEqual(['Close']);
  });

  test('error de instalação (ou sem objeto de erro): texto próprio; sem detalhe, sem bloco', () => {
    setup(stateOf('error', { error: { kind: 'install', detail: '' } }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not restart to install. The app keeps working.');
    expect(screen.queryByRole('button', { name: 'Technical details' })).toBeNull();
    cleanup();
    setup(stateOf('error', { error: null }));
    expect(screen.getByRole('alert')).toHaveTextContent('The update could not be downloaded.');
  });

  test('idle não renderiza nada; versão nula não quebra', () => {
    const { container } = setup(stateOf('idle'));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    expect(() => setup(stateOf('available', { version: null, currentVersion: null }))).not.toThrow();
  });

  test('notas com HTML e links perigosos não viram elementos', () => {
    setup(stateOf('available', { notes: '<script>alert(1)</script>\n[x](javascript:alert(1))\n[ok](https://a.com)' }));
    expect(dialog().querySelector('script')).toBeNull();
    const hrefs = [...dialog().querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://a.com/']);
  });
});

describe('UpdateModal: botões enviam a ação certa', () => {
  test.each<[UpdatePhase, Partial<UpdateState>, [string, UpdateAction][]]>([
    ['available', {}, [['Not now', 'later'], ['Download and install', 'download']]],
    ['portable-available', { mode: 'portable' }, [['Not now', 'dismiss'], ['Open download page', 'openDownloadPage']]],
    ['ready', {}, [['Install when closing the app', 'installOnQuit'], ['Restart and install', 'restart']]],
    ['error', { error: { kind: 'download', detail: 'x' } }, [['Close', 'dismiss']]],
  ])('%s', async (phase, extra, expected) => {
    const { onAction, onHide } = setup(stateOf(phase, extra));
    for (const [label, action] of expected) {
      onAction.mockClear();
      await userEvent.click(footer().getByRole('button', { name: label }));
      expect(onAction.mock.calls).toEqual([[action]]);
    }
    expect(onHide).not.toHaveBeenCalled();
  });

  test('downloading: "Keep using the app" esconde, sem enviar nada', async () => {
    const { onAction, onHide } = setup(stateOf('downloading', { percent: 30 }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep using the app' }));
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
  });

  test('o principal recebe o foco inicial', async () => {
    for (const [phase, label] of [['available', 'Download and install'], ['ready', 'Restart and install'], ['downloading', 'Keep using the app'], ['error', 'Close']] as const) {
      setup(stateOf(phase, { error: { kind: 'download', detail: '' } }));
      const primary = footer().getByRole('button', { name: label });
      await vi.waitFor(() => expect(primary).toHaveFocus());
      cleanup();
    }
  });

  test('busy trava os botões de ação e o X', () => {
    for (const phase of ['available', 'portable-available', 'ready', 'error'] as const) {
      setup(stateOf(phase, { error: { kind: 'install', detail: '' } }), { busy: true });
      const buttons = within(dialog()).getAllByRole('button').filter((b) => !b.hasAttribute('aria-expanded'));
      expect(buttons.length).toBeGreaterThan(1);
      for (const button of buttons) expect(button).toBeDisabled();
      cleanup();
    }
  });

  test('sem busy os botões ficam ativos', () => {
    setup(stateOf('available'));
    for (const button of within(dialog()).getAllByRole('button')) expect(button).toBeEnabled();
  });
});

describe('UpdateModal: X e Esc por fase (D190 com V102-Q2)', () => {
  test.each<[UpdatePhase, string]>([
    ['available', 'later'],
    ['portable-available', 'dismiss'],
    ['error', 'dismiss'],
    ['ready', 'hide'],
    ['downloading', 'hide'],
  ])('%s: Esc e X fazem %s', async (phase, expected) => {
    for (const how of ['esc', 'x'] as const) {
      const { onAction, onHide, unmount } = setup(stateOf(phase, { error: { kind: 'download', detail: '' } }));
      if (how === 'esc') await userEvent.keyboard('{Escape}');
      else await userEvent.click(within(dialog()).getAllByRole('button', { name: 'Close' })[0]);
      if (expected === 'hide') {
        expect(onHide).toHaveBeenCalledTimes(1);
        expect(onAction).not.toHaveBeenCalled();
      } else {
        expect(onAction.mock.calls).toEqual([[expected]]);
        expect(onHide).not.toHaveBeenCalled();
      }
      unmount();
    }
  });

  test('em ready o X e o Esc nunca enviam installOnQuit nem restart', async () => {
    const { onAction } = setup(stateOf('ready'));
    await userEvent.keyboard('{Escape}');
    expect(onAction).not.toHaveBeenCalled();
  });

  test('installing: o X fica desativado e o Esc não faz nada', async () => {
    const { onAction, onHide } = setup(stateOf('installing'));
    expect(within(dialog()).getByRole('button', { name: 'Close' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onAction).not.toHaveBeenCalled();
    expect(onHide).not.toHaveBeenCalled();
  });

  test('busy: Esc não envia nada', async () => {
    const { onAction } = setup(stateOf('available'), { busy: true });
    await userEvent.keyboard('{Escape}');
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe('textos desktopUpdate.* nos 13 idiomas', () => {
  const LANGUAGES = ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pl', 'pt-BR', 'ru', 'tr', 'uk', 'zh-CN'] as const;
  const params = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  test('toda chave desktopUpdate.* usada pelo modal e pelo selo existe e tem os mesmos parâmetros em todos', async () => {
    const used = new Set<string>();
    for (const file of ['UpdateModal.tsx', join('layout', 'UpdateBadge.tsx')]) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      for (const match of source.matchAll(/'(desktopUpdate\.[A-Za-z]+)'/g)) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(15);
    const en = (await loadMessages('en')) as unknown as { desktopUpdate: Record<string, string> };
    for (const language of LANGUAGES) {
      const dict = (await loadMessages(language)) as unknown as { desktopUpdate: Record<string, string> };
      expect(Object.keys(dict.desktopUpdate).sort(), language).toEqual(Object.keys(en.desktopUpdate).sort());
      for (const key of used) {
        const name = key.split('.')[1];
        expect(dict.desktopUpdate[name]?.trim(), `${language}:${key}`).toBeTruthy();
        expect(params(dict.desktopUpdate[name]), `${language}:${key}`).toEqual(params(en.desktopUpdate[name]));
      }
    }
  });

  test('nenhuma fase deixa uma chave crua na tela (en, pt-BR, ja)', async () => {
    for (const language of ['en', 'pt-BR', 'ja'] as const) {
      const messages = await loadMessages(language);
      for (const phase of UPDATE_PHASES) {
        const { unmount } = renderUi(
          <UpdateModal state={stateOf(phase, { percent: 10, error: { kind: 'install', detail: 'x' } })} language={language} busy={false} onAction={() => {}} onHide={() => {}} />,
          { language, messages },
        );
        expect(document.body.textContent ?? '', `${phase}/${language}`).not.toMatch(/desktopUpdate\.|common\.close/);
        unmount();
      }
    }
  });
});
