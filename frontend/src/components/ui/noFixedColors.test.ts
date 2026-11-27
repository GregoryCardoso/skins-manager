import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { cssProblems, tsxProblems } from '../../styles/colorScan';

// D370, 12.3a: os componentes de ui/ usam cor só por token (var(--...)), transparent, currentColor, inherit, none e color-mix só com
// esses. Nada de hex, rgb(), rgba(), hsl(), oklch(), cor por nome nas propriedades de cor, nem `style` com cor nos .tsx.

const UI_DIR = __dirname;
// 12.4: o CSS e o TSX de components/layout também usam só tokens de cor.
const LAYOUT_DIR = path.join(__dirname, '..', 'layout');

function files(ext: string): string[] {
  return [UI_DIR, LAYOUT_DIR].flatMap((dir) =>
    fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(ext) && !name.endsWith('.test.tsx') && !name.endsWith('.test.ts'))
      .map((name) => path.join(dir, name)),
  );
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
