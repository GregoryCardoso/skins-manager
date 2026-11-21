import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { UpdateBridge, UpdateState } from '@/lib/desktop';

// QA da v1.0.2: o DesktopUpdateHost roda sem jsdom, com um mini executor de hooks (useState, useRef, useCallback e
// useEffect). Cada chamada de `render()` é uma renderização; os efeitos rodam depois dela, como no React.
const hooks = vi.hoisted(() => {
  const h = {
    slots: [] as { v?: unknown; current?: unknown }[],
    index: 0,
    effects: [] as { fn: () => void | (() => void); deps: unknown[] | undefined; cleanup?: void | (() => void) }[],
    effectIndex: 0,
    bridge: null as unknown,
    language: 'pt-BR',
    reset() {
      h.slots = [];
      h.index = 0;
      h.effects = [];
      h.effectIndex = 0;
    },
  };
  return h;
});

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      const slot = (hooks.slots[hooks.index] ??= { v: typeof initial === 'function' ? (initial as () => unknown)() : initial });
      hooks.index += 1;
      const setter = (next: unknown) => {
        slot.v = typeof next === 'function' ? (next as (p: unknown) => unknown)(slot.v) : next;
      };
      return [slot.v, setter];
    },
    useRef: (initial: unknown) => {
      const slot = (hooks.slots[hooks.index] ??= { current: initial });
      hooks.index += 1;
      return slot;
    },
    useCallback: (fn: unknown, deps: unknown[]) => {
      const slot = hooks.slots[hooks.index] as { v?: { fn: unknown; deps: unknown[] } } | undefined;
      hooks.index += 1;
      if (slot && slot.v && deps.every((d, k) => d === slot.v!.deps[k])) return slot.v.fn;
      hooks.slots[hooks.index - 1] = { v: { fn, deps } };
      return fn;
    },
    useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
      const i = hooks.effectIndex;
      hooks.effectIndex += 1;
      const previous = hooks.effects[i];
      const changed = !previous || !deps || !previous.deps || deps.some((d, k) => d !== previous.deps![k]);
      if (changed) hooks.effects[i] = { fn, deps, cleanup: previous?.cleanup };
      else hooks.effects[i] = { ...previous, fn };
      if (changed) hooks.effects[i].deps = deps;
      (hooks.effects[i] as { dirty?: boolean }).dirty = changed;
    },
  };
});

vi.mock('@/i18n/I18nProvider', () => ({
  useLanguage: () => hooks.language,
  useT: () => (key: string) => key,
}));

vi.mock('@/lib/desktop', async () => {
  const actual = await vi.importActual<typeof import('@/lib/desktop')>('@/lib/desktop');
  return { ...actual, getUpdateBridge: () => hooks.bridge };
});

import DesktopUpdateHost from './DesktopUpdateHost';

type Element = { props: { state: UpdateState; language: string; busy: boolean; onAction: (a: string) => void; onHide: () => void } } | null;

function render(): Element {
  hooks.index = 0;
  hooks.effectIndex = 0;
  const element = (DesktopUpdateHost as unknown as () => Element)();
  for (const effect of hooks.effects as { fn: () => void | (() => void); cleanup?: void | (() => void); dirty?: boolean }[]) {
    if (effect.dirty) {
      if (typeof effect.cleanup === 'function') effect.cleanup();
      effect.cleanup = effect.fn();
      effect.dirty = false;
    }
  }
  return element;
}

function unmount() {
  for (const effect of hooks.effects) if (typeof effect.cleanup === 'function') effect.cleanup();
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

function stateOf(phase: UpdateState['phase'], seq: number, extra: Partial<UpdateState> = {}): UpdateState {
  return { seq, phase, mode: 'installer', version: '1.1.0', currentVersion: '1.0.0', notes: '', percent: null, error: null, ...extra };
}

function makeBridge(initial: UpdateState) {
  let listener: ((s: UpdateState) => void) | null = null;
  const unsubscribe = vi.fn(() => {
    listener = null;
  });
  const bridge = {
    isDesktop: true,
    getAppInfo: vi.fn(),
    checkForUpdates: vi.fn(),
    getUpdateState: vi.fn(async () => initial),
    respondToUpdate: vi.fn(async (_a: string, seq: number) => ({ accepted: true, state: stateOf('idle', seq + 1) })),
    onUpdateState: vi.fn((cb: (s: UpdateState) => void) => {
      listener = cb;
      return unsubscribe;
    }),
  } as unknown as UpdateBridge & { getUpdateState: ReturnType<typeof vi.fn>; respondToUpdate: ReturnType<typeof vi.fn>; onUpdateState: ReturnType<typeof vi.fn> };
  return { bridge, unsubscribe, push: (s: unknown) => listener && (listener as (s: unknown) => void)(s), hasListener: () => listener !== null };
}

beforeEach(() => {
  hooks.reset();
  hooks.bridge = null;
  hooks.language = 'pt-BR';
});

describe('DesktopUpdateHost: montagem e inscrição', () => {
  test('sem a ponte do desktop não renderiza nada nem registra efeitos de rede', () => {
    expect(render()).toBeNull();
  });

  test('ao montar, busca o estado uma vez e se inscreve uma vez', async () => {
    const m = makeBridge(stateOf('available', 3));
    hooks.bridge = m.bridge;
    expect(render()).toBeNull();
    await flush();
    expect(m.bridge.getUpdateState).toHaveBeenCalledTimes(1);
    expect(m.bridge.onUpdateState).toHaveBeenCalledTimes(1);
    const element = render();
    expect(element?.props.state).toMatchObject({ phase: 'available', seq: 3 });
    expect(element?.props.language).toBe('pt-BR');
    // novas renderizações não repetem a busca nem a inscrição
    render();
    expect(m.bridge.getUpdateState).toHaveBeenCalledTimes(1);
    expect(m.bridge.onUpdateState).toHaveBeenCalledTimes(1);
  });

  test('ao desmontar, cancela a inscrição e ignora estados que chegarem depois', async () => {
    const m = makeBridge(stateOf('idle', 0));
    hooks.bridge = m.bridge;
    render();
    await flush();
    const push = m.push;
    unmount();
    expect(m.unsubscribe).toHaveBeenCalledTimes(1);
    expect(m.hasListener()).toBe(false);
    push(stateOf('available', 9));
    expect(render()?.props.state.seq ?? 0).not.toBe(9);
  });

  test('falha ao buscar o estado inicial não quebra (o modal só não aparece)', async () => {
    const m = makeBridge(stateOf('idle', 0));
    m.bridge.getUpdateState.mockRejectedValue(new Error('canal fechado'));
    hooks.bridge = m.bridge;
    render();
    await flush();
    expect(render()).toBeNull();
  });

  test('estado inválido (do IPC) é ignorado: formato errado, fase desconhecida, seq negativo', async () => {
    const m = makeBridge(stateOf('idle', 0));
    hooks.bridge = m.bridge;
    render();
    await flush();
    for (const bad of [null, 'x', 5, [], {}, { ...stateOf('available', 1), phase: 'hackeado' }, { ...stateOf('available', 1), seq: -1 }, { ...stateOf('available', 1), notes: 5 }, { ...stateOf('available', 1), error: { kind: 'x', detail: 1 } }, { ...stateOf('downloading', 1), percent: 500 }]) {
      m.push(bad);
      expect(render()).toBeNull();
    }
  });

  test('estado com seq menor que o atual é ignorado; seq igual ou maior vale', async () => {
    const m = makeBridge(stateOf('idle', 0));
    hooks.bridge = m.bridge;
    render();
    await flush();
    m.push(stateOf('available', 5));
    expect(render()?.props.state.seq).toBe(5);
    m.push(stateOf('idle', 3));
    expect(render()?.props.state).toMatchObject({ seq: 5, phase: 'available' });
    m.push(stateOf('downloading', 6, { percent: 1 }));
    expect(render()?.props.state.phase).toBe('downloading');
  });

  test('a troca de idioma chega ao modal na próxima renderização', async () => {
    const m = makeBridge(stateOf('available', 1));
    hooks.bridge = m.bridge;
    render();
    await flush();
    expect(render()?.props.language).toBe('pt-BR');
    hooks.language = 'en';
    expect(render()?.props.language).toBe('en');
  });
});

describe('DesktopUpdateHost: respostas e esconder', () => {
  test('onAction envia a ação com o seq do estado atual e aplica o estado devolvido', async () => {
    const m = makeBridge(stateOf('available', 7));
    hooks.bridge = m.bridge;
    render();
    await flush();
    render()?.props.onAction('later');
    expect(m.bridge.respondToUpdate).toHaveBeenCalledWith('later', 7);
    await flush();
    expect(render()).toBeNull(); // idle
  });

  test('enquanto a resposta não volta, um segundo clique é ignorado (busy)', async () => {
    const m = makeBridge(stateOf('available', 7));
    let resolve!: (v: unknown) => void;
    m.bridge.respondToUpdate.mockImplementation(() => new Promise((r) => (resolve = r)));
    hooks.bridge = m.bridge;
    render();
    await flush();
    render()?.props.onAction('download');
    const busyElement = render();
    expect(busyElement?.props.busy).toBe(true);
    busyElement?.props.onAction('download');
    expect(m.bridge.respondToUpdate).toHaveBeenCalledTimes(1);
    resolve({ accepted: true, state: stateOf('downloading', 8, { percent: 0 }) });
    await flush();
    const after = render();
    expect(after?.props.busy).toBe(false);
    expect(after?.props.state.phase).toBe('downloading');
  });

  test('resposta recusada (accepted false) mostra o estado atual devolvido pelo main', async () => {
    const m = makeBridge(stateOf('available', 7));
    m.bridge.respondToUpdate.mockResolvedValue({ accepted: false, state: stateOf('ready', 9) });
    hooks.bridge = m.bridge;
    render();
    await flush();
    render()?.props.onAction('download');
    await flush();
    expect(render()?.props.state).toMatchObject({ phase: 'ready', seq: 9 });
  });

  test('erro no invoke (canal recusou) libera o busy e mantém o modal', async () => {
    const m = makeBridge(stateOf('available', 7));
    m.bridge.respondToUpdate.mockRejectedValue(new Error('Origem não autorizada.'));
    hooks.bridge = m.bridge;
    render();
    await flush();
    render()?.props.onAction('download');
    await flush();
    const element = render();
    expect(element?.props.busy).toBe(false);
    expect(element?.props.state.phase).toBe('available');
  });

  test('resposta com formato inválido é ignorada', async () => {
    const m = makeBridge(stateOf('available', 7));
    m.bridge.respondToUpdate.mockResolvedValue({ accepted: true, state: { phase: 'x' } });
    hooks.bridge = m.bridge;
    render();
    await flush();
    render()?.props.onAction('download');
    await flush();
    expect(render()?.props.state.phase).toBe('available');
  });

  test('esconder em ready: some, não envia nada ao main, e reaparece com o seq novo (reabrir pelo card Sobre)', async () => {
    const m = makeBridge(stateOf('ready', 10));
    hooks.bridge = m.bridge;
    render();
    await flush();
    render()?.props.onHide();
    expect(render()).toBeNull();
    expect(m.bridge.respondToUpdate).not.toHaveBeenCalled();
    m.push(stateOf('ready', 11)); // evento "reopen" do main
    expect(render()?.props.state).toMatchObject({ phase: 'ready', seq: 11 });
  });

  test('esconder em downloading: o progresso não reabre; a mudança de fase reabre', async () => {
    const m = makeBridge(stateOf('downloading', 20, { percent: 1 }));
    hooks.bridge = m.bridge;
    render();
    await flush();
    render()?.props.onHide();
    expect(render()).toBeNull();
    m.push(stateOf('downloading', 21, { percent: 2 }));
    m.push(stateOf('downloading', 22, { percent: 3 }));
    expect(render()).toBeNull();
    m.push(stateOf('ready', 23));
    expect(render()?.props.state.phase).toBe('ready');
  });

  test('esconder em downloading e o download falhar: o erro aparece', async () => {
    const m = makeBridge(stateOf('downloading', 20, { percent: 1 }));
    hooks.bridge = m.bridge;
    render();
    await flush();
    render()?.props.onHide();
    m.push(stateOf('error', 21, { error: { kind: 'download', detail: 'x' } }));
    expect(render()?.props.state.phase).toBe('error');
  });

  // BUG (v1.0.2): o marcador `hidden` nunca é limpo. Depois de esconder um download que falha, o modal do download
  // seguinte (nova tentativa) nasce escondido sem o usuário ter clicado em nada. Este teste descreve o comportamento
  // correto e por isso está como `fails`: quando o código for corrigido ele passa a falhar e o `.fails` deve sair.
  test('esconder um download, ele falhar e uma nova tentativa: o modal do segundo download aparece', async () => {
    const m = makeBridge(stateOf('downloading', 20, { percent: 1 }));
    hooks.bridge = m.bridge;
    render();
    await flush();
    render()?.props.onHide();
    m.push(stateOf('error', 21, { error: { kind: 'download', detail: 'x' } }));
    expect(render()?.props.state.phase).toBe('error');
    m.push(stateOf('idle', 22));
    m.push(stateOf('available', 23));
    m.push(stateOf('downloading', 24, { percent: 0 }));
    expect(render()?.props.state.phase).toBe('downloading');
  });
});
