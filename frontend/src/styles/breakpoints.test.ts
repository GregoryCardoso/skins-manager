import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { BREAKPOINTS, CONTAINER_BREAKPOINTS, HEIGHT_BREAKPOINTS } from './breakpoints';
import { LIGHT_SELECTOR, readBlock } from './parseTokens';

const SRC_DIR = path.join(__dirname, '..');

// 12.11: todos os *.module.css (e o globals.css) do frontend seguem as mesmas listas de larguras e alturas.
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function cssFiles(): string[] {
  return walk(SRC_DIR).filter((file) => file.endsWith('.module.css') || path.basename(file) === 'globals.css');
}

interface Query {
  kind: 'media' | 'container';
  prelude: string;
}

export function findQueries(css: string): Query[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return [...withoutComments.matchAll(/@(media|container)\b([^{]*)\{/g)].map((m) => ({ kind: m[1] as Query['kind'], prelude: m[2] }));
}

// Devolve os problemas de uma consulta: unidade que não seja px, largura fora das listas, altura fora de 600/700.
export function checkQuery(query: Query): string[] {
  const problems: string[] = [];
  const widths: readonly number[] = Object.values(query.kind === 'media' ? BREAKPOINTS : CONTAINER_BREAKPOINTS);
  for (const [, condition] of query.prelude.matchAll(/\(([^()]*)\)/g)) {
    const isHeight = /\bheight\b/.test(condition);
    const isWidth = /\b(width|inline-size)\b/.test(condition);
    if (!isHeight && !isWidth) continue;
    for (const [, value, unit] of condition.matchAll(/(\d+(?:\.\d+)?)([a-z%]*)/g)) {
      if (unit !== 'px') {
        problems.push(`(${condition.trim()}): use px`);
        continue;
      }
      const allowed = isHeight ? (HEIGHT_BREAKPOINTS as readonly number[]) : widths;
      if (!allowed.includes(Number(value))) problems.push(`(${condition.trim()}): ${value}px fora da lista`);
    }
  }
  return problems;
}

describe('breakpoints', () => {
  test('os valores do tokens.css (--bp-*) são os de breakpoints.ts', () => {
    const css = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf8');
    // As variáveis independentes do tema ficam no último bloco `:root {`.
    const tokens: Record<string, string> = {};
    for (const m of css.matchAll(/--bp-([a-z]+):\s*(\d+)px;/g)) tokens[m[1]] = m[2];
    expect(Object.fromEntries(Object.entries(BREAKPOINTS).map(([name, value]) => [name, String(value)]))).toEqual(tokens);
    expect(Object.keys(readBlock(css, LIGHT_SELECTOR)).some((key) => key.startsWith('bp-'))).toBe(false);
  });

  test('a varredura enxerga os CSS de ui, layout, telas e componentes soltos', () => {
    const names = cssFiles().map((file) => path.relative(SRC_DIR, file).split(path.sep).join('/'));
    expect(names.length).toBeGreaterThan(60);
    expect(names).toEqual(expect.arrayContaining(['components/ui/Dialog.module.css', 'components/layout/AppShell.module.css', 'app/globals.css', 'app/profit/page.module.css']));
  });

  test('as faixas estão em ordem crescente', () => {
    const values = Object.values(BREAKPOINTS);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });

  test('todo @media/@container de todos os *.module.css usa só larguras e alturas das listas', () => {
    const problems: string[] = [];
    for (const file of cssFiles()) {
      for (const query of findQueries(fs.readFileSync(file, 'utf8'))) {
        for (const problem of checkQuery(query)) problems.push(`${path.basename(file)}: ${problem}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('o verificador pega valores fora das listas (guarda contra teste cego)', () => {
    expect(checkQuery({ kind: 'media', prelude: ' (width < 899px)' })).toHaveLength(1);
    expect(checkQuery({ kind: 'media', prelude: ' (width < 900px)' })).toEqual([]);
    expect(checkQuery({ kind: 'container', prelude: ' (width < 960px)' })).toEqual([]);
    expect(checkQuery({ kind: 'container', prelude: ' (width < 900px)' })).toHaveLength(1);
    expect(checkQuery({ kind: 'media', prelude: ' (height < 700px)' })).toEqual([]);
    expect(checkQuery({ kind: 'media', prelude: ' (height < 650px)' })).toHaveLength(1);
    expect(checkQuery({ kind: 'media', prelude: ' (width < 56rem)' })).toHaveLength(1);
    expect(checkQuery({ kind: 'media', prelude: ' (prefers-reduced-motion: reduce)' })).toEqual([]);
  });
});
