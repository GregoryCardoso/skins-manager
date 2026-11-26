import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { DARK_SELECTOR, LIGHT_SELECTOR, readBlock, SYSTEM_DARK_SELECTOR } from './parseTokens';

// 12.2 (D370): contraste AA dos pares principais de tokens nos dois temas. Lê src/styles/tokens.css (a fonte dos valores).
const css = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf8');

const themes = { light: readBlock(css, LIGHT_SELECTOR), dark: readBlock(css, DARK_SELECTOR) };
const mediaDark = readBlock(css, SYSTEM_DARK_SELECTOR);

type Rgba = [number, number, number, number];

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(value);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
  throw new Error(`cor não suportada: ${value}`);
}

function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [primeiro plano, fundo, mínimo]: 4.5 para texto, 3 para elementos gráficos e foco.
const TEXT_PAIRS: Array<[string, string, number]> = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'surface-2', 4.5],
  ['muted', 'surface', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'surface-2', 4.5],
  ['brand-ink', 'brand', 4.5],
  ['loss-ink', 'loss', 4.5],
  ['brand', 'surface', 4.5],
  ['profit', 'surface', 4.5],
  ['loss', 'surface', 4.5],
  ['stuck', 'surface', 4.5],
  ['lock', 'surface', 4.5],
  ['focus', 'bg', 3],
  ['focus', 'surface', 3],
];
// Texto colorido sobre o fundo suave usado nos avisos e nas linhas (o suave é translúcido sobre a superfície).
const SOFT_PAIRS: Array<[string, string]> = [
  ['stuck', 'stuck-soft'],
  ['loss', 'loss-soft'],
  ['lock', 'lock-soft'],
  ['profit', 'profit-soft'],
  ['text', 'stuck-soft'],
  ['text', 'lock-soft'],
  ['text', 'loss-soft'],
  ['text', 'brand-soft'],
];

describe.each(Object.entries(themes))('contraste AA, tema %s', (_name, tokens) => {
  test.each(TEXT_PAIRS)('%s sobre %s >= %s', (fg, bg, min) => {
    expect(contrast(parse(tokens[fg]), parse(tokens[bg]))).toBeGreaterThanOrEqual(min);
  });
  test.each(SOFT_PAIRS)('%s sobre %s (translúcido sobre a superfície) >= 4.5', (fg, soft) => {
    const bg = over(parse(tokens[soft]), parse(tokens.surface));
    expect(contrast(parse(tokens[fg]), bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('estrutura dos tokens', () => {
  test('claro e escuro têm as mesmas chaves de cor', () => {
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
  });
  test('o bloco do sistema (sem JavaScript) repete o escuro', () => {
    expect(mediaDark).toEqual(themes.dark);
  });
});
