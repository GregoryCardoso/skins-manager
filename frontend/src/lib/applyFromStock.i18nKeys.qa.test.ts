// 10.3 (D362), QA: toda chave de tradução usada literalmente nos componentes da aplicação do estoque existe nos dois idiomas;
// as chaves dinâmicas (`applyForm.kinds.*`, `applyForm.limit.*`) têm todas as variantes; novos códigos de erro, rótulos de enum e avisos existem.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { API_ERROR_CODES } from '@/i18n/errorCodes';

const flatten = (node: unknown, prefix = ''): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') Object.assign(out, { [full]: value });
    else Object.assign(out, flatten(value, full));
  }
  return out;
};
const dicts = { 'pt-BR': flatten(ptBR), en: flatten(en) };
const COMPONENT_DIR = path.resolve(__dirname, '../components');
const FILES = ['ApplyComponentModal.tsx', 'ItemOperationsList.tsx', 'AppliedComponentsEditor.tsx', 'CostCell.tsx', 'ItemActions.tsx', 'ItemHistoryBox.tsx'];

describe('chaves de tradução dos componentes novos', () => {
  test('toda chave literal t(\'...\') existe em pt-BR e en', () => {
    const missing: string[] = [];
    for (const file of FILES) {
      const full = path.join(COMPONENT_DIR, file);
      if (!fs.existsSync(full)) continue;
      const source = fs.readFileSync(full, 'utf8');
      for (const m of source.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)) {
        for (const [lang, dict] of Object.entries(dicts)) if (!(m[1] in dict)) missing.push(`${lang}:${m[1]} (${file})`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('chaves dinâmicas: todos os tipos de componente e todas as mensagens de limite', () => {
    for (const dict of Object.values(dicts)) {
      for (const kind of ['STICKER', 'CHARM', 'STICKER_SLAB', 'PATCH']) expect(dict[`applyForm.kinds.${kind}`]?.trim(), kind).toBeTruthy();
      const limits = Object.keys(dict).filter((k) => k.startsWith('applyForm.limit.'));
      expect(limits.length).toBeGreaterThan(0);
    }
  });

  test('rótulos novos (CONSUMIDO, GERADO, PATCH, aviso da importação, contador do histórico) existem nos dois idiomas, por sufixo da chave', () => {
    for (const dict of Object.values(dicts)) {
      for (const suffix of ['.status.CONSUMIDO', '.acquisitionType.GERADO', 'COMPONENT_MAYBE_APPLIED_FROM_STOCK', '.consumedCount.one', '.consumedCount.other']) {
        const hit = Object.entries(dict).find(([k]) => k.endsWith(suffix));
        expect(hit?.[1]?.trim(), suffix).toBeTruthy();
      }
      expect(Object.keys(dict).filter((k) => k.endsWith('.PATCH')).length).toBeGreaterThan(0);
    }
  });

  test('todo código de erro novo da 10.3 está na lista e tem texto nos dois idiomas', () => {
    const codes = [
      'APPLY_SOURCE_NOT_APPLICABLE', 'ITEM_NOT_IN_STOCK', 'ITEM_CONSUMED', 'ITEM_IN_OPERATION', 'OPERATION_DATE_INVALID', 'OPERATION_NOT_FOUND',
      'OPERATION_ALREADY_UNDONE', 'OPERATION_UNDO_BLOCKED', 'COMPONENT_NOT_FOUND', 'COMPONENT_NOT_SCRAPEABLE',
    ];
    for (const code of codes) {
      expect(API_ERROR_CODES as readonly string[]).toContain(code);
      for (const dict of Object.values(dicts)) expect(dict[`errors.${code}`]?.trim(), code).toBeTruthy();
    }
  });
});
