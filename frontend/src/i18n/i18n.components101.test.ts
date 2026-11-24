import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { API_ERROR_CODES } from './errorCodes';
import en from './en.json';
import ptBR from './pt-BR.json';

// 10.1: todas as chaves novas dos componentes existem em pt-BR e en, com os mesmos marcadores {param}.
function leaves(node: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof node === 'string') return { [prefix]: node };
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) Object.assign(out, leaves(value, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

const pt = leaves(ptBR);
const enMap = leaves(en);
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const NEW_PREFIXES = ['itemForm.components.', 'inventory.group.withComponents', 'inventory.group.quantitySplit'];
const COMPONENT_ERRORS = [
  'COMPONENTS_NOT_ALLOWED', 'COMPONENT_LIMIT_EXCEEDED', 'COMPONENT_CATALOG_REQUIRED', 'COMPONENT_CATALOG_MISMATCH',
  'COMPONENT_SLOT_TAKEN', 'INVALID_COMPONENT_FIELD',
];

describe('chaves novas da 10.1', () => {
  test('o conjunto de chaves de pt-BR e en é o mesmo (nenhuma chave falta)', () => {
    expect(Object.keys(enMap).sort()).toEqual(Object.keys(pt).sort());
  });

  test('o bloco itemForm.components existe nos dois idiomas, sem textos vazios', () => {
    const keys = Object.keys(pt).filter((k) => k.startsWith('itemForm.components.'));
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      expect(pt[key].trim(), `pt-BR ${key}`).not.toBe('');
      expect(enMap[key]?.trim(), `en ${key}`).toBeTruthy();
    }
  });

  test('os marcadores {param} das chaves novas são os mesmos nos dois idiomas', () => {
    const keys = Object.keys(pt).filter((k) => NEW_PREFIXES.some((p) => k.startsWith(p)) || k.startsWith('errors.COMPONENT'));
    for (const key of keys) expect(placeholders(enMap[key]), key).toEqual(placeholders(pt[key]));
  });

  test('os seis códigos de erro novos estão em errorCodes e traduzidos (errors.* e errorsIndexed.* quando existir)', () => {
    for (const code of COMPONENT_ERRORS) {
      expect(API_ERROR_CODES).toContain(code);
      expect(pt[`errors.${code}`], `pt-BR errors.${code}`).toBeTruthy();
      expect(enMap[`errors.${code}`], `en errors.${code}`).toBeTruthy();
    }
  });

  test('toda chave estática t("...") usada nos componentes da 10.1 existe nos dois idiomas', () => {
    const root = path.join(__dirname, '..');
    const files = [
      'components/ItemComponentsSection.tsx', 'components/ComponentThumbs.tsx', 'components/ItemFormModal.tsx',
      'components/InventoryGroupTable.tsx', 'components/InventoryUnitRow.tsx', 'components/SalesTable.tsx', 'components/CatalogAutocomplete.tsx',
    ];
    const missing: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      const keys = new Set([...source.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)].map((m) => m[1]));
      // t(cond ? 'a.b' : 'c.d'): pega também as chaves literais do ternário
      for (const m of source.matchAll(/\bt\([^)]*\?\s*'([A-Za-z0-9_.]+)'\s*:\s*'([A-Za-z0-9_.]+)'/g)) {
        keys.add(m[1]);
        keys.add(m[2]);
      }
      for (const key of keys) {
        const exists = (map: Record<string, string>) => key in map || Object.keys(map).some((k) => k.startsWith(`${key}.`)); // chave de plural
        if (!exists(pt)) missing.push(`pt-BR ${file}: ${key}`);
        if (!exists(enMap)) missing.push(`en ${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('a chave de plural withComponents tem one e other nos dois idiomas', () => {
    for (const map of [pt, enMap]) {
      expect(map['inventory.group.withComponents.one']).toBeTruthy();
      expect(map['inventory.group.withComponents.other']).toBeTruthy();
    }
  });
});
