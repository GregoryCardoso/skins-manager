import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate } from '@/i18n/translate';

const source = fs.readFileSync(path.join(__dirname, 'SummaryCards.tsx'), 'utf8');
const holders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('SummaryCards: chaves i18n (8.4)', () => {
  const keys = [...new Set([...source.matchAll(/\bt\('([\w.]+)'/g)].map((m) => m[1]))];

  test('o componente usa chaves literais (a extração encontrou algo)', () => {
    expect(keys.length).toBeGreaterThan(15);
  });

  test.each(keys)('chave %s existe nos dois idiomas com os mesmos {marcadores}', (key) => {
    const pt = translate(ptBR, key);
    const enText = translate(en, key);
    expect(pt, `pt-BR ${key}`).not.toBe(key);
    expect(enText, `en ${key}`).not.toBe(key);
    expect(holders(enText)).toEqual(holders(pt));
  });

  test('todos os códigos de aviso do backend têm texto traduzido (warnings.<code>)', () => {
    for (const code of ['FX_NOT_CONFIGURED', 'BALANCE_MAYBE_OUTDATED', 'FEES_NOT_CONFIGURED', 'PRICE_OVERFLOW']) {
      expect(translate(ptBR, `warnings.${code}`)).not.toBe(`warnings.${code}`);
      expect(translate(en, `warnings.${code}`)).not.toBe(`warnings.${code}`);
    }
  });

  test('textos do pendente e do liberado em en', () => {
    expect(translate(en, 'profit.pendingIncluded', { amount: '$1', date: 'Nov 25' })).toBe('includes ≈ $1 pending (releases from Nov 25)');
    expect(translate(ptBR, 'profit.releasedIncluded', { amount: 'R$ 1' })).toContain('liberado após o último saldo registrado');
  });
});

describe('versão 1.1.0 (D209)', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

  test.each(['package.json', 'backend/package.json', 'frontend/package.json', 'desktop/package.json'])('%s está em 1.1.0', (rel) => {
    expect(read(rel).version).toBe('1.1.0');
  });

  test.each(['package-lock.json', 'backend/package-lock.json', 'frontend/package-lock.json', 'desktop/package-lock.json'])(
    '%s está em 1.1.0 (raiz e packages[""])',
    (rel) => {
      const lock = read(rel);
      expect(lock.version).toBe('1.1.0');
      expect(lock.packages[''].version).toBe('1.1.0');
    },
  );
});
