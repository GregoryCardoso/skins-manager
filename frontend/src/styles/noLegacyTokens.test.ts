import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { DARK_SELECTOR, LIGHT_SELECTOR, readBlock } from './parseTokens';

// 12.11 (D370, item 2): os apelidos dos nomes antigos dos tokens foram removidos de tokens.css; nenhum CSS (nem TSX) pode usá-los.
const SRC_DIR = path.join(__dirname, '..');
const LEGACY_TO_NEW: Record<string, string> = {
  border: 'line',
  'surface-alt': 'surface-2',
  'text-muted': 'muted',
  accent: 'brand',
  'accent-text': 'brand-ink',
  success: 'profit',
  danger: 'loss',
  'danger-text': 'loss-ink',
  warning: 'stuck',
  info: 'brand',
  'warning-bg': 'stuck-soft',
  'danger-bg': 'loss-soft',
  'row-stagnant': 'stuck-soft',
  'row-locked': 'lock-soft',
};

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

export function legacyUses(text: string): string[] {
  const found: string[] = [];
  for (const name of Object.keys(LEGACY_TO_NEW)) {
    if (new RegExp(`--${name}(?![\\w-])`).test(text)) found.push(`--${name} (use --${LEGACY_TO_NEW[name]})`);
  }
  return found;
}

describe('apelidos dos tokens antigos removidos', () => {
  test('tokens.css não define os nomes antigos e define os novos', () => {
    const css = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf8');
    for (const selector of [LIGHT_SELECTOR, DARK_SELECTOR]) {
      const block = readBlock(css, selector);
      for (const oldName of Object.keys(LEGACY_TO_NEW)) expect(block).not.toHaveProperty(oldName);
    }
    expect(legacyUses(css)).toEqual([]);
    const light = readBlock(css, LIGHT_SELECTOR);
    for (const newName of new Set(Object.values(LEGACY_TO_NEW))) expect(light).toHaveProperty(newName);
  });

  test('nenhum CSS, TS ou TSX do frontend usa os nomes antigos', () => {
    const files = walk(SRC_DIR).filter((f) => /\.(css|tsx?)$/.test(f) && !/noLegacyTokens\.test\.ts$/.test(f));
    expect(files.length).toBeGreaterThan(200);
    const problems = files.flatMap((file) => legacyUses(fs.readFileSync(file, 'utf8')).map((p) => `${path.relative(SRC_DIR, file)}: ${p}`));
    expect(problems).toEqual([]);
    // Lê centenas de arquivos: com a máquina carregada (suítes em paralelo), o limite padrão de 5 s estourou uma vez.
  }, 30_000);

  test('o verificador pega os nomes antigos sem confundir com nomes novos (guarda contra teste cego)', () => {
    expect(legacyUses('a { color: var(--accent); }')).toHaveLength(1);
    expect(legacyUses('a { color: var(--text-muted); border: 1px solid var(--border); }')).toHaveLength(2);
    expect(legacyUses('a { color: var(--accent-text); }')).toHaveLength(1);
    expect(legacyUses('a { border-radius: var(--radius-md); height: var(--row-height); color: var(--brand); }')).toEqual([]);
  });
});
