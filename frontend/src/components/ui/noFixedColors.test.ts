import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

// D370, 12.3a: os componentes de ui/ usam cor só por token (var(--...)), transparent, currentColor, inherit, none e color-mix só com
// esses. Nada de hex, rgb(), rgba(), hsl(), oklch(), cor por nome nas propriedades de cor, nem `style` com cor nos .tsx.

const UI_DIR = __dirname;
const COLOR_PROPS = /^(color|background|background-color|background-image|border|border-[a-z-]+|fill|stroke|outline|outline-color|box-shadow|text-decoration-color|caret-color|accent-color)$/;
const NAMED_COLORS = [
  'white', 'black', 'red', 'green', 'blue', 'gray', 'grey', 'orange', 'yellow', 'purple', 'pink', 'brown', 'cyan', 'magenta', 'silver',
  'gold', 'navy', 'teal', 'lime', 'maroon', 'olive', 'aqua', 'fuchsia', 'coral', 'crimson', 'indigo', 'violet', 'tomato', 'salmon', 'khaki',
];

function files(ext: string): string[] {
  return fs
    .readdirSync(UI_DIR)
    .filter((name) => name.endsWith(ext) && !name.endsWith('.test.tsx') && !name.endsWith('.test.ts'))
    .map((name) => path.join(UI_DIR, name));
}

// Remove var(...) (com um nível de parênteses aninhado, como var(--a, var(--b))).
const stripVars = (value: string) => value.replace(/var\((?:[^()]|\([^()]*\))*\)/g, ' ');

export function cssProblems(css: string): string[] {
  const problems: string[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const m of text.matchAll(/(^|[;{\s])([a-z-]+)\s*:\s*([^;{}]+)(?=;|})/g)) {
    const [, , prop, rawValue] = m;
    const value = stripVars(rawValue);
    if (/#[0-9a-fA-F]{3,8}\b/.test(value) || /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i.test(value)) problems.push(`${prop}: ${rawValue.trim()}`);
    else if (COLOR_PROPS.test(prop) && NAMED_COLORS.some((name) => new RegExp(`(^|[\\s,(])${name}(?=[\\s,)]|$)`, 'i').test(value))) problems.push(`${prop}: ${rawValue.trim()}`);
  }
  return problems;
}

export function tsxProblems(code: string): string[] {
  const problems: string[] = [];
  const text = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1');
  if (/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/.test(text.replace(/&#\d+;/g, ''))) problems.push('hex');
  if (/\b(rgba?|hsla?|oklch)\(/i.test(text)) problems.push('função de cor');
  for (const m of text.matchAll(/style=\{\{([^}]*)\}\}/g)) {
    if (/color|background|border|fill|stroke|outline|shadow/i.test(m[1])) problems.push(`style: ${m[1].trim()}`);
  }
  return problems;
}

describe('cores só por token em components/ui', () => {
  test('há arquivos para verificar', () => {
    expect(files('.module.css').length).toBeGreaterThan(10);
    expect(files('.tsx').length).toBeGreaterThan(10);
  });

  test('nenhum .module.css usa cor fixa', () => {
    const problems = files('.module.css').flatMap((file) => cssProblems(fs.readFileSync(file, 'utf8')).map((p) => `${path.basename(file)}: ${p}`));
    expect(problems).toEqual([]);
  });

  test('nenhum .tsx usa cor fixa nem style com cor', () => {
    const problems = files('.tsx').flatMap((file) => tsxProblems(fs.readFileSync(file, 'utf8')).map((p) => `${path.basename(file)}: ${p}`));
    expect(problems).toEqual([]);
  });

  test('o verificador pega cores fixas (guarda contra teste cego)', () => {
    expect(cssProblems('.a { color: #fff; }')).toHaveLength(1);
    expect(cssProblems('.a { background: rgb(0 0 0 / 50%); }')).toHaveLength(1);
    expect(cssProblems('.a { border: 1px solid red; }')).toHaveLength(1);
    expect(cssProblems('.a { box-shadow: 0 0 0 2px hsl(10 10% 10%); }')).toHaveLength(1);
    expect(cssProblems('.a { background: color-mix(in srgb, #000 40%, transparent); }')).toHaveLength(1);
    expect(cssProblems('.a { color: var(--text); background: color-mix(in srgb, var(--bg) 70%, transparent); border: 1px solid var(--line); outline: none; }')).toEqual([]);
    expect(cssProblems('.a { color: currentColor; background: transparent; border-color: inherit; }')).toEqual([]);
    expect(tsxProblems('const a = <i style={{ color: "red" }} />;')).toHaveLength(1);
    expect(tsxProblems('const a = <i style={{ width: "10%" }} />;')).toEqual([]);
    expect(tsxProblems("const c = '#0f7c6e';")).toHaveLength(1);
  });
});
