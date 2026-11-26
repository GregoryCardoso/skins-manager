'use strict';

// loading.html (12.10, parte 2): a CSP libera o script inline só por hash, sem 'unsafe-inline' em script-src.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'loading.html'), 'utf8');
const tokens = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'styles', 'tokens.css'), 'utf8');

function csp() {
  const match = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html);
  expect(match).not.toBeNull();
  return Object.fromEntries(
    match[1]
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...values] = part.split(/\s+/);
        return [name, values];
      }),
  );
}

// O parser de HTML normaliza CRLF para LF antes de o navegador calcular o hash.
function inlineScripts() {
  return [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1] || '', text: m[2].replace(/\r\n/g, '\n') }));
}

describe('loading.html: CSP', () => {
  test('script-src só tem o hash do script inline (se o script mudar, atualize o hash na CSP)', () => {
    const scripts = inlineScripts();
    expect(scripts).toHaveLength(1);
    const hash = crypto.createHash('sha256').update(scripts[0].text, 'utf8').digest('base64');
    expect(csp()['script-src']).toEqual([`'sha256-${hash}'`]);
  });

  test('sem unsafe-inline nem unsafe-eval em script-src, e o padrão é bloquear tudo', () => {
    const policy = csp();
    expect(policy['default-src']).toEqual(["'none'"]);
    expect(policy['script-src'].join(' ')).not.toMatch(/unsafe-/);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i); // nada de onclick="..." (não passaria na CSP)
    expect(html).not.toMatch(/javascript:/i);
  });

  test('sem script externo, imagem externa nem conexão de rede', () => {
    expect(inlineScripts().every((s) => !/\ssrc\s*=/.test(s.attrs))).toBe(true);
    expect(html).not.toMatch(/https?:\/\//);
    expect(csp()['connect-src']).toBeUndefined();
  });

  test('o script escreve textos só por textContent (nunca innerHTML)', () => {
    const script = inlineScripts()[0].text;
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
    expect(script).toMatch(/textContent/);
  });

  test('o script só fala com a API fixa skinsDesktop.screen', () => {
    const script = inlineScripts()[0].text;
    expect(script).toMatch(/skinsDesktop\.screen/);
    expect(script).not.toMatch(/ipcRenderer|require\(|fetch\(|XMLHttpRequest|window\.open|location\s*=/);
  });
});

describe('loading.html: identidade e carregamento', () => {
  test('continua bilíngue (en/pt-BR) no carregamento', () => {
    expect(html).toContain('Iniciando&hellip; / Starting&hellip;');
    expect(html).toContain('<h1>Skins Manager</h1>');
  });

  test.each([
    ['claro', ':root {'],
    ['escuro', ":root[data-theme='dark'] {"],
  ])('as cores do tema %s são as de tokens.css', (label, selector) => {
    const read = (source, from) => {
      const block = source.slice(source.indexOf(from));
      const end = block.indexOf('}');
      return block.slice(0, end);
    };
    const own = read(html, selector);
    const original = read(tokens, selector);
    for (const name of ['bg', 'surface', 'surface-2', 'line', 'text', 'muted', 'brand', 'brand-ink', 'loss', 'focus']) {
      const pick = (block) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1]?.toLowerCase();
      expect([name, pick(own)]).toEqual([name, pick(original)]);
    }
  });

  test('tem a logo embutida, foco visível, região viva e respeita movimento reduzido', () => {
    expect(html).toContain('id="logo-mark"');
    expect(html).toMatch(/:focus-visible/);
    expect(html).toMatch(/prefers-reduced-motion/);
    expect(html).toMatch(/role="status"/);
    expect(html).toMatch(/setAttribute\('role', state\.kind === 'error' \? 'alert' : 'status'\)/);
  });
});
