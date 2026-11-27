import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';

// QA 8.5: paridade total de chaves e toda chave literal usada nos arquivos alterados da 8.5 existe nos dois idiomas
// (folha de texto ou par one/other dos plurais).
type Tree = { [key: string]: string | Tree };

function leafPaths(node: Tree, prefix = ''): string[] {
  return Object.entries(node).flatMap(([key, value]) => (
    typeof value === 'string' ? [`${prefix}${key}`] : leafPaths(value, `${prefix}${key}.`)
  ));
}

function lookup(tree: Tree, key: string): string | Tree | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string' || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

const exists = (tree: Tree, key: string) => {
  const node = lookup(tree, key);
  if (typeof node === 'string') return true;
  return typeof node === 'object' && node !== null && typeof node.one === 'string' && typeof node.other === 'string';
};

describe('paridade pt-BR x en (8.5)', () => {
  const pt = leafPaths(ptBR as Tree).sort();
  const enKeys = leafPaths(en as Tree).sort();
  test('mesmas chaves nos dois idiomas', () => {
    expect(enKeys.filter((k) => !pt.includes(k))).toEqual([]);
    expect(pt.filter((k) => !enKeys.includes(k))).toEqual([]);
  });
  test('mesmos {marcadores} em cada chave', () => {
    const holders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');
    const bad = pt.filter((key) => holders(lookup(ptBR as Tree, key) as string) !== holders(lookup(en as Tree, key) as string));
    expect(bad).toEqual([]);
  });
  test('nenhum texto vazio', () => {
    for (const tree of [ptBR, en]) {
      for (const key of leafPaths(tree as Tree)) expect((lookup(tree as Tree, key) as string).trim(), key).not.toBe('');
    }
  });
});

describe('chaves usadas nos arquivos alterados da 8.5', () => {
  const root = path.join(__dirname, '..');
  const files = [
    'app/profit/page.tsx', 'components/DepositFormModal.tsx', 'components/DepositsTable.tsx', 'components/StoreBalancesPanel.tsx',
    'components/ProfitEquation.tsx', 'components/ProfitInfoStrip.tsx', 'components/WithdrawalFormModal.tsx', 'components/WithdrawalsSection.tsx',
    'components/WithdrawalsTable.tsx', 'components/MoneyApprox.tsx', 'lib/depositForm.ts', 'lib/withdrawalForm.ts', 'lib/baseMoney.ts',
  ];
  const NAMESPACES = Object.keys(ptBR).join('|');
  const literal = new RegExp(`['"\`]((?:${NAMESPACES})\\.[A-Za-z0-9_.]+)['"\`]`, 'g');

  test.each(files)('%s: toda chave literal existe nos dois idiomas', (file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const keys = [...new Set([...source.matchAll(literal)].map((m) => m[1]))];
    const missing = keys.filter((key) => !exists(ptBR as Tree, key) || !exists(en as Tree, key));
    expect(missing).toEqual([]);
  });

  test('os arquivos usam, no total, uma quantidade razoável de chaves (a varredura enxerga as chamadas)', () => {
    const all = files.flatMap((file) => [...fs.readFileSync(path.join(root, file), 'utf8').matchAll(literal)]);
    expect(all.length).toBeGreaterThan(40);
  });

  test('nenhum componente ou lib usa as chaves removidas na 8.5', () => {
    const removed = ['deposits.form.amount', 'deposits.form.storeHint', 'deposits.form.noStore', 'withdrawals.form.received', 'withdrawals.form.receivedRequired', 'profit.summary.usdApprox'];
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
    });
    const offenders: string[] = [];
    for (const file of walk(root)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const key of removed) if (new RegExp(`['"\`]${key.replace(/\./g, '\\.')}['"\`]`).test(source)) offenders.push(`${path.relative(root, file)}: ${key}`);
    }
    expect(offenders).toEqual([]);
  });
});
