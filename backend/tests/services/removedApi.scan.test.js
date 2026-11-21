'use strict';

// Varredura (D163, D165, D166, D162): nomes removidos não podem sobrar em backend/src nem em frontend/src,
// e backupRetention.js (D64) não pode importar nada do projeto.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'out' ? [] : walk(full);
    return /\.(js|ts|tsx|json|css)$/.test(entry.name) ? [full] : [];
  });
}

const REMOVED = [
  'effectiveRate',
  'EFFECTIVE_RATE',
  'simulateWithdrawal',
  'BELOW_FEE',
  'WITHDRAWAL_NOT_ALLOWED',
  'recentWithdrawals',
  'computeWithdrawalFee',
  'estimateWithdrawable',
  'PTAX_FETCH_FAILED',
  'PTAX_INVALID_RESPONSE',
  'PTAX_REFRESH_IN_PROGRESS',
  'refreshPtax',
  'ptaxQuotedAt',
  'ptax_quoted_at',
  'fx-rate/ptax',
];

describe('nomes removidos não sobram no código de produção', () => {
  const files = [...walk(path.join(ROOT, 'backend', 'src')), ...walk(path.join(ROOT, 'frontend', 'src'))].filter(
    (f) => !/\.test\.(js|ts|tsx)$/.test(f)
  );

  test('há arquivos para varrer', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  test.each(REMOVED)('%s não aparece', (name) => {
    const hits = files.filter((f) => fs.readFileSync(f, 'utf8').includes(name)).map((f) => path.relative(ROOT, f));
    // ptax_quoted_at só pode existir na migração v5 (origem da cópia) e em schemas antigos publicados.
    const allowed = name === 'ptax_quoted_at' ? hits.filter((f) => !/migrations[\\/]v00[45]_/.test(f)) : hits;
    expect(allowed).toEqual([]);
  });

  test('o diretório antigo services/ptax não tem mais arquivos', () => {
    const dir = path.join(ROOT, 'backend', 'src', 'services', 'ptax');
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
  });
});

describe('backupRetention.js é folha do grafo de imports', () => {
  test('não faz require de nenhum módulo do projeto (nem relativo)', () => {
    const source = fs.readFileSync(path.join(ROOT, 'backend', 'src', 'config', 'backupRetention.js'), 'utf8');
    const requires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    expect(requires.filter((r) => r.startsWith('.') || r.startsWith('/'))).toEqual([]);
    expect(source).not.toMatch(/^\s*import\s/m);
  });

  test('exports puros: carregar o módulo isolado não carrega config/database nem services', () => {
    jest.isolateModules(() => {
      const before = new Set(Object.keys(require.cache));
      require('../../src/config/backupRetention');
      const loaded = Object.keys(require.cache).filter((k) => !before.has(k));
      expect(loaded.filter((k) => /[\\/]src[\\/](?!config[\\/]backupRetention)/.test(k))).toEqual([]);
    });
  });
});
