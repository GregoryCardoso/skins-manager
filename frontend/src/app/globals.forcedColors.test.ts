import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

// Auditoria 12.11: no modo de alto contraste do Windows o box-shadow que serve de anel de foco some. O jsdom não tem forced-colors,
// então a regra só pode ser conferida pelo texto do CSS (não há outro jeito de exercitar essa media query).
describe('globals.css: foco no modo de alto contraste', () => {
  const css = readFileSync(path.join(__dirname, 'globals.css'), 'utf8');

  test('há um bloco forced-colors que devolve o contorno ao :focus-visible', () => {
    const block = css.match(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/);
    expect(block).not.toBeNull();
    expect(block?.[1]).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid Highlight !important/);
  });
});
