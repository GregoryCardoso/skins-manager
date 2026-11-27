import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { LANGUAGE_REGISTRY } from './languages';

// QA da 12.6b (D370): as 14 chaves novas existem, não estão vazias e mantêm os marcadores {x} do inglês nos 13 idiomas; toda chave
// literal usada pelos componentes da venda, do desfazer e das operações existe em todos; sellForm.minPriceRef foi removida.
type Json = { [key: string]: Json | string };
const root = path.join(__dirname, '..');
const read = (code: string): Json => JSON.parse(fs.readFileSync(path.join(__dirname, `${code}.json`), 'utf8')) as Json;
const get = (dict: Json, key: string): Json | string | undefined =>
  key.split('.').reduce<Json | string | undefined>((node, part) => (typeof node === 'object' ? node[part] : undefined), dict);
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');

const NEW_KEYS = [
  'sellForm.unit', 'sellForm.minPriceLabel', 'sellForm.youReceive', 'sellForm.feesMissing', 'history.avgDaysLegend',
  'unsell.effect.available', 'unsell.effect.pending', 'unsell.effect.none', 'unsell.effect.change', 'unsell.effect.negative',
  'unsell.effect.returnsForSale', 'unsell.effect.returnsHolding', 'unsell.effect.loadError', 'unsell.effect.currencyMismatch',
];
const FILES = [
  'components/SellItemModal.tsx', 'components/item/UnsellDialog.tsx', 'components/OpenContainerModal.tsx', 'components/ApplyComponentModal.tsx',
  'components/DetachComponentModal.tsx', 'components/ItemHistoryBox.tsx', 'components/ItemOperationsList.tsx', 'components/ItemDialogs.tsx',
];

function usedKeys(): string[] {
  const keys = new Set<string>(NEW_KEYS);
  for (const file of FILES) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z]+(?:\.[\w]+)+)'/g)) keys.add(match[1]);
  }
  return [...keys];
}

const codes = LANGUAGE_REGISTRY.map((entry) => entry.code);

describe('chaves da venda, do desfazer e das operações (12.6b)', () => {
  test('13 idiomas e chaves encontradas', () => {
    expect(codes).toHaveLength(13);
    expect(NEW_KEYS).toHaveLength(14);
    expect(usedKeys().length).toBeGreaterThan(60);
  });

  test.each(codes)('%s tem todas as chaves, sem vazio, com os marcadores do inglês', (code) => {
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

  test.each(codes)('%s: a chave removida sellForm.minPriceRef não existe mais', (code) => {
    expect(get(read(code), 'sellForm.minPriceRef')).toBeUndefined();
  });

  test('fora do inglês, os textos novos não ficam iguais ao inglês (exceto os sem palavras)', () => {
    const en = read('en');
    const same: string[] = [];
    for (const code of codes.filter((c) => c !== 'en')) {
      const dict = read(code);
      for (const key of NEW_KEYS.filter((k) => k !== 'unsell.effect.change')) {
        if (get(dict, key) === get(en, key)) same.push(`${code}:${key}`);
      }
    }
    expect(same).toEqual([]);
  });

  test('"{before} → {after}" é igual em todos (só marcadores)', () => {
    for (const code of codes) expect(get(read(code), 'unsell.effect.change')).toBe('{before} → {after}');
  });
});
