import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

// D209: todas as partes do app têm a mesma versão. Sem número fixo: o `desktop:release` sobe a versão (ex.: 1.1.0 -> 1.1.1)
// antes de rodar os testes, e um número fixo aqui quebrava toda publicação nova. (Movido de SummaryCards.i18n.test.ts na 12.7b.)
describe('versão do app (D209)', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  const expected = read('package.json').version as string;

  test('a versão da raiz é semver x.y.z e pelo menos 1.1.0 (a versão do lucro real)', () => {
    expect(expected).toMatch(/^\d+\.\d+\.\d+$/);
    const [major, minor] = expected.split('.').map(Number);
    expect(major > 1 || (major === 1 && minor >= 1)).toBe(true);
  });

  test.each(['backend/package.json', 'frontend/package.json', 'desktop/package.json'])('%s tem a mesma versão da raiz', (rel) => {
    expect(read(rel).version).toBe(expected);
  });

  test.each(['package-lock.json', 'backend/package-lock.json', 'frontend/package-lock.json', 'desktop/package-lock.json'])(
    '%s tem a mesma versão da raiz (raiz e packages[""])',
    (rel) => {
      const lock = read(rel);
      expect(lock.version).toBe(expected);
      expect(lock.packages[''].version).toBe(expected);
    },
  );
});
