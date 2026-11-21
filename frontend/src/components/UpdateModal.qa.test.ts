import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate } from '@/i18n/translate';
import type { UpdateAction, UpdatePhase, UpdateState } from '@/lib/desktop';

// QA da v1.0.2: botões, X/Esc e travas do UpdateModal por fase. O componente é chamado como função (o `useT` é
// simulado) e a árvore de elementos é percorrida; o `Modal` é trocado por um marcador que expõe as props.
vi.mock('@/i18n/I18nProvider', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params),
}));
vi.mock('./Modal', () => ({ default: function Modal() { return null; } }));

import UpdateModal, { closeActionFor } from './UpdateModal';

interface Found {
  label: string;
  onClick: () => void;
  disabled: boolean;
  className: string;
}

function walk(node: ReactNode, visit: (el: ReactElement<Record<string, unknown>>) => void) {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  if (!isValidElement(node)) return;
  const el = node as ReactElement<Record<string, unknown>>;
  visit(el);
  walk(el.props.children as ReactNode, visit);
}

const textOf = (node: ReactNode): string => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node as ReactElement<{ children?: ReactNode }>).props.children);
  return '';
};

function inspect(state: UpdateState, { busy = false } = {}) {
  const onAction = vi.fn();
  const onHide = vi.fn();
  const tree = (UpdateModal as unknown as (p: unknown) => ReactElement | null)({
    state,
    language: 'pt-BR',
    busy,
    onAction,
    onHide,
  });
  if (tree === null) return { tree, buttons: [] as Found[], onAction, onHide, modal: null as null | Record<string, unknown> };
  const buttons: Found[] = [];
  walk(tree, (el) => {
    if (el.type === 'button') {
      buttons.push({
        label: textOf(el.props.children as ReactNode),
        onClick: el.props.onClick as () => void,
        disabled: el.props.disabled === true,
        className: String(el.props.className ?? ''),
      });
    }
  });
  return { tree, buttons, onAction, onHide, modal: tree.props as Record<string, unknown> };
}

const stateOf = (phase: UpdatePhase, extra: Partial<UpdateState> = {}): UpdateState => ({
  seq: 4,
  phase,
  mode: 'installer',
  version: '1.1.0',
  currentVersion: '1.0.0',
  notes: '',
  percent: null,
  error: null,
  ...extra,
});

const label = (key: string) => translate(ptBR, key);

describe('UpdateModal: botões e ações por fase', () => {
  test.each<[UpdatePhase, Partial<UpdateState>, [string, UpdateAction][]]>([
    ['available', {}, [[label('desktopUpdate.later'), 'later'], [label('desktopUpdate.download'), 'download']]],
    ['portable-available', { mode: 'portable' }, [[label('desktopUpdate.later'), 'dismiss'], [label('desktopUpdate.openDownloadPage'), 'openDownloadPage']]],
    ['ready', {}, [[label('desktopUpdate.installOnQuit'), 'installOnQuit'], [label('desktopUpdate.restartNow'), 'restart']]],
    ['error', { error: { kind: 'download', detail: 'x' } }, [[label('common.close'), 'dismiss']]],
  ])('%s: cada botão envia a ação certa, e só ela', (phase, extra, expected) => {
    const { buttons, onAction, onHide } = inspect(stateOf(phase, extra));
    expect(buttons.map((b) => b.label)).toEqual(expected.map(([text]) => text));
    buttons.forEach((button, i) => {
      onAction.mockClear();
      button.onClick();
      expect(onAction.mock.calls).toEqual([[expected[i][1]]]);
    });
    expect(onHide).not.toHaveBeenCalled();
  });

  test('o botão principal é o último e o único com a classe primária', () => {
    for (const phase of ['available', 'portable-available', 'ready'] as UpdatePhase[]) {
      const { buttons } = inspect(stateOf(phase));
      expect(buttons.map((b) => /primary/.test(b.className))).toEqual([false, true]);
    }
  });

  test('downloading: só "Esconder", que não envia nada ao main e funciona mesmo com busy', () => {
    for (const busy of [false, true]) {
      const { buttons, onAction, onHide } = inspect(stateOf('downloading', { percent: 30 }), { busy });
      expect(buttons.map((b) => b.label)).toEqual([label('desktopUpdate.hide')]);
      buttons[0].onClick();
      expect(onHide).toHaveBeenCalledTimes(1);
      expect(onAction).not.toHaveBeenCalled();
    }
  });

  test('installing: nenhum botão e o modal fica travado (nada fecha)', () => {
    const { buttons, modal, onAction, onHide } = inspect(stateOf('installing'));
    expect(buttons).toEqual([]);
    expect(modal).toMatchObject({ busy: true });
    (modal!.onClose as () => void)();
    expect(onAction).not.toHaveBeenCalled();
    expect(onHide).not.toHaveBeenCalled();
  });

  test('idle não renderiza nada', () => {
    expect(inspect(stateOf('idle')).tree).toBeNull();
  });

  test.each<UpdatePhase>(['available', 'portable-available', 'ready', 'error'])('%s com busy: todos os botões desativados', (phase) => {
    const { buttons, modal } = inspect(stateOf(phase, { error: { kind: 'install', detail: '' } }), { busy: true });
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(modal).toMatchObject({ busy: true });
  });

  test('sem busy os botões ficam ativos', () => {
    for (const phase of ['available', 'portable-available', 'ready', 'error'] as UpdatePhase[]) {
      expect(inspect(stateOf(phase)).buttons.every((b) => !b.disabled)).toBe(true);
    }
  });
});

describe('UpdateModal: X e Esc (onClose do Modal) por fase (D190 com V102-Q2)', () => {
  test.each<[UpdatePhase, string]>([
    ['available', 'later'],
    ['portable-available', 'dismiss'],
    ['error', 'dismiss'],
    ['ready', 'hide'],
    ['downloading', 'hide'],
    ['installing', 'nada'],
  ])('%s: fechar faz %s', (phase, expected) => {
    const { modal, onAction, onHide } = inspect(stateOf(phase, { error: { kind: 'download', detail: '' } }));
    (modal!.onClose as () => void)();
    if (expected === 'hide') {
      expect(onHide).toHaveBeenCalledTimes(1);
      expect(onAction).not.toHaveBeenCalled();
    } else if (expected === 'nada') {
      expect(onHide).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
    } else {
      expect(onAction.mock.calls).toEqual([[expected]]);
      expect(onHide).not.toHaveBeenCalled();
    }
  });

  test('em ready o X e o Esc NUNCA enviam installOnQuit nem restart', () => {
    const { modal, onAction } = inspect(stateOf('ready'));
    (modal!.onClose as () => void)();
    expect(onAction).not.toHaveBeenCalledWith('installOnQuit');
    expect(onAction).not.toHaveBeenCalledWith('restart');
    expect(onAction).not.toHaveBeenCalled();
  });

  test('closeActionFor devolve null para idle e para fases desconhecidas', () => {
    expect(closeActionFor('idle')).toBeNull();
    expect(closeActionFor('installing')).toBeNull();
    expect(closeActionFor('qualquer' as UpdatePhase)).toBeNull();
  });

  test('o Modal só é "wide" nas fases com notas', () => {
    const wide = (phase: UpdatePhase) => inspect(stateOf(phase, { error: { kind: 'download', detail: '' } })).modal!.wide;
    expect(wide('available')).toBe(true);
    expect(wide('portable-available')).toBe(true);
    for (const phase of ['downloading', 'ready', 'installing', 'error'] as UpdatePhase[]) expect(wide(phase)).toBe(false);
  });
});

describe('UpdateModal: casos de borda', () => {
  test('error sem objeto de erro ou com tipo desconhecido usa o texto de download e não quebra', () => {
    for (const error of [null, { kind: 'outro', detail: '' } as unknown as UpdateState['error']]) {
      const { tree } = inspect(stateOf('error', { error }));
      expect(textOf(tree)).toContain(label('desktopUpdate.errorDownload'));
    }
  });

  test('error de instalação mostra o texto próprio e o detalhe só em texto', () => {
    const { tree } = inspect(stateOf('error', { error: { kind: 'install', detail: '<img src=x onerror=alert(1)>' } }));
    const flat = textOf(tree);
    expect(flat).toContain(label('desktopUpdate.errorInstall'));
    expect(flat).toContain('<img src=x onerror=alert(1)>');
    let hasImgElement = false;
    walk(tree, (el) => {
      if (el.type === 'img') hasImgElement = true;
    });
    expect(hasImgElement).toBe(false);
  });

  test('downloading com percent 0 e 100 mostra a porcentagem; null não mostra', () => {
    expect(textOf(inspect(stateOf('downloading', { percent: 0 })).tree)).toContain('0%');
    expect(textOf(inspect(stateOf('downloading', { percent: 100 })).tree)).toContain('100%');
    expect(textOf(inspect(stateOf('downloading', { percent: null })).tree)).not.toMatch(/\d+%/);
  });

  test('versão nula não quebra (mostra texto vazio no lugar)', () => {
    expect(() => inspect(stateOf('available', { version: null, currentVersion: null }))).not.toThrow();
    expect(() => inspect(stateOf('ready', { version: null }))).not.toThrow();
  });

  test('paridade: toda chave desktopUpdate.* usada pelo componente existe nos dois idiomas', () => {
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'UpdateModal.tsx'), 'utf8') as string;
    const keys = [...source.matchAll(/'(desktopUpdate\.[A-Za-z]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(10);
    for (const key of new Set(keys)) {
      for (const dict of [ptBR, en]) {
        const value = translate(dict, key);
        expect(value, key).not.toBe(key);
        expect(value.trim(), key).not.toBe('');
      }
    }
  });
});
