import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { cssProblems, literalColorProblems } from './colorScan';

// 12.11 (D370): nenhuma cor fixa (hex, rgb(), hsl(), nome de cor) em *.module.css, globals.css e style={{}} / .tsx de todo o frontend,
// fora de tokens.css. Cor só por token (var(--...)), transparent, currentColor, inherit, none e color-mix com esses.
// O teste de ui/noFixedColors.test.ts continua valendo para ui/ e layout/ com a regra mais estrita de `style` com cor.

const SRC_DIR = path.join(__dirname, '..');

// Exceções justificadas, por caminho relativo a src/ e com o motivo. O teste-guarda abaixo exige que cada uma ainda precise existir.
const EXCEPTIONS: Record<string, string> = {
  'components/Logo.tsx': 'Marca do app (SVG): as cores do gradiente, do brilho e do contorno são fixas nos dois temas, como no ícone do executável.',
};

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const rel = (file: string) => path.relative(SRC_DIR, file).split(path.sep).join('/');
const isTest = (file: string) => /\.test\.tsx?$/.test(file);

const cssFiles = () => walk(SRC_DIR).filter((f) => (f.endsWith('.module.css') || path.basename(f) === 'globals.css') && rel(f) !== 'styles/tokens.css');
const tsxFiles = () => walk(SRC_DIR).filter((f) => f.endsWith('.tsx') && !isTest(f));

describe('nenhuma cor fixa fora de tokens.css', () => {
  test('a varredura enxerga os arquivos esperados', () => {
    expect(cssFiles().length).toBeGreaterThan(60);
    expect(tsxFiles().length).toBeGreaterThan(100);
    expect(cssFiles().map(rel)).not.toContain('styles/tokens.css');
  });

  test('nenhum *.module.css (nem globals.css) usa cor fixa', () => {
    const problems = cssFiles().flatMap((file) => cssProblems(fs.readFileSync(file, 'utf8')).map((p) => `${rel(file)}: ${p}`));
    expect(problems).toEqual([]);
  });

  test('nenhum .tsx usa cor fixa (hex, função de cor, style com nome de cor), salvo as exceções', () => {
    const problems = tsxFiles()
      .filter((file) => !(rel(file) in EXCEPTIONS))
      .flatMap((file) => literalColorProblems(fs.readFileSync(file, 'utf8')).map((p) => `${rel(file)}: ${p}`));
    expect(problems).toEqual([]);
  });

  test('cada exceção existe e ainda tem cor fixa (a lista não apodrece)', () => {
    for (const [file, reason] of Object.entries(EXCEPTIONS)) {
      expect(reason.length).toBeGreaterThan(10);
      const full = path.join(SRC_DIR, file);
      expect(fs.existsSync(full)).toBe(true);
      expect(literalColorProblems(fs.readFileSync(full, 'utf8')).length).toBeGreaterThan(0);
    }
  });

  test('o verificador pega cores fixas (guarda contra teste cego)', () => {
    expect(cssProblems('.a { color: #fff; }')).toHaveLength(1);
    expect(cssProblems('.a { background: rgba(0, 0, 0, 0.5); }')).toHaveLength(1);
    expect(cssProblems('.a { color: var(--text); border: 1px solid var(--line); }')).toEqual([]);
    expect(literalColorProblems('const a = <i style={{ color: "red" }} />;')).toHaveLength(1);
    expect(literalColorProblems("const a = <i style={{ background: '#0f7c6e' }} />;")).toHaveLength(1);
    expect(literalColorProblems('const a = <i style={{ boxShadow: `var(--shadow-${s})` }} />;')).toEqual([]);
    expect(literalColorProblems('const a = <i style={{ background: palette.bg }} />;')).toEqual([]);
    expect(literalColorProblems('const a = <a href="#main">x</a>; // #fff')).toEqual([]);
  });
});
