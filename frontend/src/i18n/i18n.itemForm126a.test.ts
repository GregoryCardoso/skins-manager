import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { LANGUAGE_REGISTRY } from './languages';

// QA da 12.6a: toda chave literal t('itemForm.…') / t('inventory.actions.…') usada pelos componentes do formulário do item existe,
// não está vazia e mantém os marcadores {x} do inglês nos 13 idiomas. Mais as 10 chaves novas da decisão D370.
type Json = { [key: string]: Json | string };
const root = path.join(__dirname, '..');
const read = (code: string): Json => JSON.parse(fs.readFileSync(path.join(__dirname, `${code}.json`), 'utf8')) as Json;
const get = (dict: Json, key: string): Json | string | undefined =>
  key.split('.').reduce<Json | string | undefined>((node, part) => (typeof node === 'object' ? node[part] : undefined), dict);
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');

const FILES = [
  'components/ItemFormModal.tsx', 'components/ItemIdentityFields.tsx', 'components/item/AcquisitionFields.tsx',
  'components/item/CatalogCombobox.tsx', 'components/item/ComponentsPanel.tsx',
];
const NEW_KEYS = [
  'itemForm.receivedAt', 'itemForm.sections.item', 'itemForm.sections.acquisition', 'itemForm.sections.components',
  'itemForm.generatedLockedHint', 'itemForm.components.originCameWith', 'itemForm.components.originApplied',
  'itemForm.components.saveFirst', 'itemForm.components.panelHint', 'inventory.actions.components',
];

function usedKeys(): string[] {
  const keys = new Set<string>(NEW_KEYS);
  for (const file of FILES) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/\bt\(\s*'((?:itemForm|inventory\.actions|operations|common)\.[\w.]+)'/g)) keys.add(match[1]);
  }
  return [...keys];
}

const codes = LANGUAGE_REGISTRY.map((entry) => entry.code);

describe('chaves do formulário do item (12.6a)', () => {
  test('o registro tem os 13 idiomas e o teste encontrou as chaves usadas', () => {
    expect(codes).toHaveLength(13);
    expect(usedKeys().length).toBeGreaterThan(40);
  });

  test.each(codes)('%s tem todas as chaves usadas, sem vazio e com os mesmos marcadores do inglês', (code) => {
    const en = read('en');
    const dict = read(code);
    for (const key of usedKeys()) {
      const base = get(en, key);
      expect(typeof base, `en:${key}`).toBe('string');
      const value = get(dict, key);
      expect(typeof value, `${code}:${key}`).toBe('string');
      expect((value as string).trim().length, `${code}:${key} vazio`).toBeGreaterThan(0);
      expect(placeholders(value as string), `${code}:${key} marcadores`).toBe(placeholders(base as string));
    }
  });
});
