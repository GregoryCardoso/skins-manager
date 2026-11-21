import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate } from '@/i18n/translate';
import { UPDATE_PHASES, type UpdatePhase, type UpdateState } from '@/lib/desktop';

// Sem jsdom: o idioma é trocado por esta variável, lida pelo `useT` simulado.
const lang = vi.hoisted(() => ({ current: 'pt-BR' as 'pt-BR' | 'en' }));

vi.mock('@/i18n/I18nProvider', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    translate(lang.current === 'en' ? en : ptBR, key, params),
}));

import UpdateModal, { closeActionFor, isModalHidden } from './UpdateModal';

const NOTES = '<!-- pt-BR -->\n## Novidades\n- **Modal** novo\n\n<!-- en -->\n## What is new\n- **New** dialog';

function stateOf(phase: UpdatePhase, extra: Partial<UpdateState> = {}): UpdateState {
  return {
    seq: 4,
    phase,
    mode: 'installer',
    version: '1.1.0',
    currentVersion: '1.0.0',
    notes: NOTES,
    percent: null,
    error: null,
    ...extra,
  };
}

function render(state: UpdateState, language: 'pt-BR' | 'en' = 'pt-BR', extra: { busy?: boolean } = {}) {
  lang.current = language;
  return renderToStaticMarkup(
    createElement(UpdateModal, { state, language, busy: extra.busy ?? false, onAction: () => {}, onHide: () => {} }),
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&gt;/g, '>').replace(/\s+/g, ' ');
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim()).filter((b) => b !== '×');

describe('closeActionFor (D190 e V102-Q2)', () => {
  test('uma escolha por fase', () => {
    expect(closeActionFor('available')).toBe('later');
    expect(closeActionFor('portable-available')).toBe('dismiss');
    expect(closeActionFor('error')).toBe('dismiss');
    expect(closeActionFor('downloading')).toBe('hide');
    expect(closeActionFor('installing')).toBeNull();
    expect(closeActionFor('idle')).toBeNull();
  });

  test('em ready, X/Esc só esconde: nunca escolhe "instalar ao fechar"', () => {
    expect(closeActionFor('ready')).toBe('hide');
    for (const phase of UPDATE_PHASES) expect(closeActionFor(phase)).not.toBe('installOnQuit');
  });
});

describe('isModalHidden', () => {
  test('sem marcador, nunca escondido', () => {
    expect(isModalHidden(null, stateOf('ready'))).toBe(false);
  });

  test('em ready vale só para o mesmo seq: a verificação manual reabre', () => {
    const hidden = { phase: 'ready' as const, seq: 4 };
    expect(isModalHidden(hidden, stateOf('ready', { seq: 4 }))).toBe(true);
    expect(isModalHidden(hidden, stateOf('ready', { seq: 5 }))).toBe(false);
  });

  test('em downloading vale enquanto a fase for a mesma, mesmo com o progresso mudando o seq', () => {
    const hidden = { phase: 'downloading' as const, seq: 7 };
    expect(isModalHidden(hidden, stateOf('downloading', { seq: 7 }))).toBe(true);
    expect(isModalHidden(hidden, stateOf('downloading', { seq: 30, percent: 80 }))).toBe(true);
    expect(isModalHidden(hidden, stateOf('ready', { seq: 31 }))).toBe(false);
    expect(isModalHidden(hidden, stateOf('error', { seq: 31 }))).toBe(false);
  });
});

describe('UpdateModal: conteúdo por fase', () => {
  test('available: versões, frase de confirmação, notas só no idioma e botões', () => {
    const html = render(stateOf('available'));
    expect(text(html)).toContain('Atualização disponível');
    expect(text(html)).toContain('Versão 1.1.0 disponível (você tem a 1.0.0).');
    expect(text(html)).toContain('Nada é baixado ou instalado sem a sua confirmação');
    expect(text(html)).toContain('Novidades');
    expect(html).toContain('<strong>Modal</strong>');
    expect(text(html)).not.toContain('What is new');
    expect(buttons(html)).toEqual(['Agora não', 'Baixar e instalar']);
    expect(html).toContain('<dialog');
  });

  test('available em inglês: notas em inglês e textos em inglês', () => {
    const html = render(stateOf('available'), 'en');
    expect(text(html)).toContain('Version 1.1.0 is available (you have 1.0.0).');
    expect(text(html)).toContain('What is new');
    expect(html).toContain('<strong>New</strong>');
    expect(text(html)).not.toContain('Novidades');
    expect(buttons(html)).toEqual(['Not now', 'Download and install']);
  });

  test('available sem notas mostra o aviso de que não há notas', () => {
    expect(text(render(stateOf('available', { notes: '' })))).toContain('Esta versão não traz notas.');
    expect(text(render(stateOf('available', { notes: '<!-- en -->\n' }), 'en'))).toContain('This version has no release notes.');
  });

  test('downloading: progresso com a porcentagem, aviso de que pode continuar usando e botão de esconder', () => {
    const html = render(stateOf('downloading', { percent: 42 }));
    expect(html).toContain('<progress');
    expect(html).toContain('max="100"');
    expect(html).toContain('value="42"');
    expect(text(html)).toContain('42%');
    expect(text(html)).toContain('Baixando a versão 1.1.0...');
    expect(text(html)).toContain('continuar usando o app');
    expect(buttons(html)).toEqual(['Esconder']);
  });

  test('downloading sem percentual: barra indeterminada', () => {
    const html = render(stateOf('downloading', { percent: null }));
    expect(html).toContain('<progress');
    expect(html).not.toContain('value=');
    expect(text(html)).not.toContain('%');
  });

  test('ready: textos de pronto, a regra de V102-Q2 e os dois botões', () => {
    const html = render(stateOf('ready'));
    expect(text(html)).toContain('Atualização pronta');
    expect(text(html)).toContain('A versão 1.1.0 foi baixada e está pronta para instalar.');
    expect(text(html)).toContain('nada é instalado agora');
    expect(text(html)).toContain('próxima abertura');
    expect(buttons(html)).toEqual(['Instalar ao fechar o app', 'Reiniciar agora']);
    expect(text(html)).not.toContain('Novidades'); // sem notas na fase pronta
  });

  test('ready em inglês', () => {
    const html = render(stateOf('ready'), 'en');
    expect(buttons(html)).toEqual(['Install when closing the app', 'Restart now']);
    expect(text(html)).toContain('nothing is installed now');
  });

  test('installing: sem botões e sem como fechar', () => {
    const html = render(stateOf('installing'));
    expect(text(html)).toContain('Reiniciando para instalar...');
    expect(buttons(html)).toEqual([]);
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="Fechar"/);
  });

  test('error de download: mensagem, detalhe em texto puro e botão de fechar', () => {
    const html = render(stateOf('error', { error: { kind: 'download', detail: 'disco <b>cheio</b>' } }));
    expect(text(html)).toContain('Não foi possível baixar a atualização.');
    expect(text(html)).not.toContain('reiniciar para instalar');
    expect(html).toContain('disco &lt;b&gt;cheio&lt;/b&gt;');
    expect(html).not.toContain('<b>cheio');
    expect(buttons(html)).toEqual(['Fechar']);
  });

  test('error de instalação: texto próprio, o app continua funcionando', () => {
    const html = render(stateOf('error', { error: { kind: 'install', detail: '' } }));
    expect(text(html)).toContain('Não foi possível reiniciar para instalar; o app continua funcionando.');
    expect(text(html)).toContain('Configurações → Sobre');
    expect(html).not.toContain('<details'); // sem detalhe, sem bloco
  });

  test('portable-available: sem "Baixar e instalar", com a página de download', () => {
    const html = render(stateOf('portable-available', { mode: 'portable' }));
    expect(text(html)).toContain('A versão portátil não se atualiza sozinha');
    expect(text(html)).not.toContain('Nada é baixado ou instalado');
    expect(buttons(html)).toEqual(['Agora não', 'Abrir página de download']);
    expect(html).not.toContain('Baixar e instalar');
    expect(html).toContain('<strong>Modal</strong>');
  });

  test('idle não renderiza nada', () => {
    expect(render(stateOf('idle'))).toBe('');
  });

  test('busy trava os botões', () => {
    for (const phase of ['available', 'ready', 'error', 'portable-available'] as const) {
      const html = render(stateOf(phase, { error: { kind: 'download', detail: 'x' } }), 'pt-BR', { busy: true });
      const actionButtons = [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].filter((m) => m[2].trim() !== '×');
      expect(actionButtons.length).toBeGreaterThan(0);
      for (const match of actionButtons) expect(match[1]).toContain('disabled');
    }
  });

  test('o markup usa as classes dos botões existentes (secundário e primário)', () => {
    const html = render(stateOf('available'));
    expect(html.match(/<button[^>]*class="[^"]*"/g)?.length).toBeGreaterThanOrEqual(3);
  });

  test('notas com HTML e links perigosos não viram elementos', () => {
    const html = render(stateOf('available', { notes: '<script>alert(1)</script>\n[x](javascript:alert(1))\n[ok](https://a.com)' }));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('javascript:');
    expect(html.match(/href="([^"]*)"/g)).toEqual(['href="https://a.com/"']);
  });
});

describe('textos desktopUpdate.* nos dois idiomas', () => {
  const keysUsed = (source: unknown, prefix: string): string[] => Object.keys((source as Record<string, Record<string, string>>)[prefix]);

  test('paridade de chaves e dos {parâmetros}', () => {
    expect(keysUsed(en, 'desktopUpdate').sort()).toEqual(keysUsed(ptBR, 'desktopUpdate').sort());
    const params = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of keysUsed(ptBR, 'desktopUpdate')) {
      const a = (ptBR as unknown as Record<string, Record<string, string>>).desktopUpdate[key];
      const b = (en as unknown as Record<string, Record<string, string>>).desktopUpdate[key];
      expect(params(b), key).toEqual(params(a));
      expect(a.trim(), key).not.toBe('');
    }
  });

  test('nenhuma fase deixa uma chave crua na tela, em nenhum idioma', () => {
    for (const language of ['pt-BR', 'en'] as const) {
      for (const phase of UPDATE_PHASES) {
        const html = render(stateOf(phase, { percent: 10, error: { kind: 'install', detail: 'x' } }), language);
        expect(html, `${phase}/${language}`).not.toMatch(/desktopUpdate\.|settings\.about\./);
      }
    }
  });
});
