import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import ptBR from '@/i18n/pt-BR.json';
import { translate } from '@/i18n/translate';

// O projeto não tem jsdom nem Testing Library. Para exercitar os ramos do componente, os hooks `useState` e
// `useEffect` são simulados: cada chamada de useState devolve o valor preparado na mesma ordem do componente
// (info, checking, result, failed) e os efeitos não rodam. A versão vem de `useQuery` (D259), também simulado. O clique do botão (onCheck) não é coberto aqui.
const hookState = vi.hoisted(() => ({ values: [] as unknown[], index: 0, version: null as string | null }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: hookState.version === null ? undefined : { version: hookState.version } }),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const i = hookState.index++;
      const value = i < hookState.values.length ? hookState.values[i] : initial;
      return [value, () => {}];
    },
    useEffect: () => {},
  };
});

vi.mock('@/i18n/I18nProvider', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params),
}));

vi.mock('@/services/api', () => ({ getHealth: vi.fn() }));

import AboutSettings from './AboutSettings';

type Info = { mode: 'installer' | 'portable' | 'dev'; version?: string } | null;
type Result = { mode: 'installer' | 'portable' | 'dev'; status: string; latestVersion?: string; percent?: number | null } | null;

function render(state: { version?: string | null; info?: Info; checking?: boolean; result?: Result; failed?: boolean }) {
  hookState.version = state.version ?? null;
  hookState.values = [state.info ?? null, state.checking ?? false, state.result ?? null, state.failed ?? false];
  hookState.index = 0;
  return renderToStaticMarkup(createElement(AboutSettings));
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

beforeEach(() => {
  hookState.index = 0;
});

describe('AboutSettings', () => {
  test('navegador / código-fonte (sem ponte): versão do health, sem botão, instrução de Git', () => {
    const html = render({ version: '1.0.0' });
    expect(text(html)).toContain('Skins Manager versão 1.0.0');
    expect(html).not.toContain('<button');
    expect(text(html)).toContain('Atualize pelo Git');
    expect(text(html)).not.toContain('instalador');
  });

  test('sem versão do servidor', () => {
    expect(text(render({ version: null }))).toContain('Versão não disponível');
  });

  test('dev: sem botão e mensagem de indisponível', () => {
    const html = render({ version: '1.0.0', info: { mode: 'dev' } });
    expect(html).not.toContain('<button');
    expect(text(html)).toContain('não está disponível neste modo');
  });

  test('instalador: rótulo do modo, botão habilitado e nota', () => {
    const html = render({ version: '1.0.0', info: { mode: 'installer' } });
    expect(text(html)).toContain('1.0.0 · instalador');
    expect(html).toContain('<button');
    expect(html).not.toContain('disabled');
    expect(text(html)).toContain('Verificar atualizações');
    expect(text(html)).toContain('Nada é baixado ou instalado sem a sua confirmação');
  });

  test('portátil: rótulo do modo e nota própria', () => {
    const html = render({ version: '1.0.0', info: { mode: 'portable' } });
    expect(text(html)).toContain('1.0.0 · portátil');
    expect(text(html)).toContain('não se atualiza sozinha');
    expect(html).toContain('<button');
  });

  test('verificando: botão desabilitado com texto de progresso', () => {
    const html = render({ version: '1.0.0', info: { mode: 'installer' }, checking: true });
    expect(html).toContain('disabled');
    expect(text(html)).toContain('Verificando...');
  });

  test.each([
    ['installer', 'up-to-date', undefined, 'Você já está na versão mais recente.'],
    ['installer', 'available', '1.1.0', 'Versão 1.1.0 disponível. Veja a janela de atualização.'],
    ['portable', 'available', '1.1.0', 'Versão 1.1.0 disponível. Veja a janela de atualização.'],
    ['installer', 'ready', '1.1.0', 'A versão 1.1.0 já foi baixada'],
    ['installer', 'busy', undefined, 'Já existe uma verificação'],
    ['installer', 'disabled', undefined, 'não está disponível neste modo'],
    ['installer', 'error', undefined, 'Não foi possível verificar as atualizações'],
    ['portable', 'error', undefined, 'Não foi possível verificar as atualizações'],
  ] as const)('resultado %s/%s mostra a mensagem certa', (mode, status, latestVersion, expected) => {
    const html = render({ version: '1.0.0', info: { mode }, result: { mode, status, latestVersion } });
    expect(text(html)).toContain(expected);
    expect(html).toContain('role="status"');
  });

  test('download em andamento mostra o percentual', () => {
    const html = render({
      info: { mode: 'installer' },
      result: { mode: 'installer', status: 'downloading', percent: 42 },
    });
    expect(text(html)).toContain('Baixando a atualização... 42%');
    expect(html).toContain('role="status"');
  });

  test('download sem percentual conhecido mostra 0%', () => {
    const html = render({ info: { mode: 'installer' }, result: { mode: 'installer', status: 'downloading' } });
    expect(text(html)).toContain('Baixando a atualização... 0%');
  });

  test('atualização já baixada avisa que a janela foi aberta de novo', () => {
    const html = render({ info: { mode: 'installer' }, result: { mode: 'installer', status: 'ready', latestVersion: '1.1.0' } });
    expect(text(html)).toContain('janela de atualização foi aberta de novo');
  });

  test('erro devolvido pela verificação usa a classe de erro; sucesso, a de ok', () => {
    const err = render({ info: { mode: 'installer' }, result: { mode: 'installer', status: 'error' } });
    const ok = render({ info: { mode: 'installer' }, result: { mode: 'installer', status: 'up-to-date' } });
    const roleStatus = (html: string) => /<p class="([^"]*)" role="status"/.exec(html)?.[1];
    expect(roleStatus(err)).not.toBe(roleStatus(ok));
  });

  test('falha da ponte (promessa rejeitada) mostra alerta de erro', () => {
    const html = render({ info: { mode: 'installer' }, failed: true });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain('Não foi possível verificar as atualizações');
  });
});
