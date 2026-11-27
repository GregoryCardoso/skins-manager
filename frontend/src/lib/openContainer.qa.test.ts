// 10.4 (D363), QA do frontend: paridade completa das chaves pt-BR/en (e dos {marcadores}), ligação dos botões (inclusive "Aplicar do estoque",
// bug da 10.3), regras do botão "Abrir", modal e invalidação executada de verdade.
import fs from 'node:fs';
import path from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { invalidateAfter } from '@/lib/queryInvalidation';
import { queryKeys } from '@/lib/queryKeys';

const SRC = path.resolve(__dirname, '..');
const read = (...parts: string[]) => fs.readFileSync(path.join(SRC, ...parts), 'utf8');

const flatten = (node: unknown, prefix = ''): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[full] = value;
    else Object.assign(out, flatten(value, full));
  }
  return out;
};
const pt = flatten(ptBR);
const enFlat = flatten(en);
const holders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('paridade i18n', () => {
  test('pt-BR e en têm exatamente as mesmas chaves (dicionário inteiro)', () => {
    const onlyPt = Object.keys(pt).filter((k) => !(k in enFlat));
    const onlyEn = Object.keys(enFlat).filter((k) => !(k in pt));
    expect({ onlyPt, onlyEn }).toEqual({ onlyPt: [], onlyEn: [] });
  });

  test('as chaves novas da 10.4 têm os mesmos {marcadores} nos dois idiomas e nenhum texto vazio', () => {
    const prefixes = ['openForm.', 'operations.generatedFrom.', 'stores.steam', 'profit.summary.consumptionLosses', 'inventory.actions.open', 'inventory.actions.registerKey', 'history.loss'];
    const keys = Object.keys(pt).filter((k) => prefixes.some((p) => k.startsWith(p)) || /^errors\.(ITEM_NOT_OPENABLE|CASE_KEY_|GENERATED_|STEAM_STORE_REQUIRED)/.test(k));
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      expect(pt[key].trim(), key).not.toBe('');
      expect(enFlat[key]?.trim(), key).toBeTruthy();
      expect(holders(enFlat[key]), key).toEqual(holders(pt[key]));
    }
  });

  test('os rótulos do tipo de operação, da perda e do desfazer existem', () => {
    for (const key of ['operations.kind.OPEN_CASE', 'operations.kind.OPEN_TERMINAL', 'operations.lost', 'operations.consumedInLost', 'operations.consumedInOpen', 'operations.undoOpenDone', 'inventory.actions.openCase', 'inventory.actions.openCapsule', 'inventory.actions.openPackage', 'inventory.actions.openTerminal']) {
      expect(pt[key], key).toBeTruthy();
      expect(enFlat[key], key).toBeTruthy();
    }
  });
});

describe('ligação dos botões', () => {
  test('o botão "Aplicar do estoque" e o "Abrir" chegam da página até a linha da unidade, nas visões individual e agrupada', () => {
    const page = read('app', 'page.tsx');
    // 12.5a: a página monta um único objeto `handlers`, repassado às duas tabelas.
    expect(page).toMatch(/onApply: openApply/);
    expect(page).toMatch(/onOpen: openOpen/);
    expect(page).toMatch(/onRegisterKey: openRegisterKey/);
    expect(page.match(/handlers=\{handlers\}/g)).toHaveLength(2);
    const actions = read('components', 'inventory', 'ItemRowActions.tsx');
    expect(actions).toMatch(/handlers\.onApply\?\.\(item\)/);
    expect(actions).toMatch(/handlers\.onOpen\?\.\(item\)/);
    for (const file of ['InventoryTable.tsx', 'InventoryGroupTable.tsx']) {
      expect(read('components', file), file).toMatch(/handlers: UnitRowHandlers/);
    }
    expect(actions).toMatch(/onApply\?: \(item: ItemView\) => void;/);
  });

  test('"Aplicar do estoque" só aparece com canReceiveComponents; "Abrir" só com item.openable', () => {
    const actions = read('components', 'ItemActions.tsx');
    expect(actions).toMatch(/item\.canReceiveComponents && onApply/);
    expect(actions).toMatch(/item\.openable && onOpen/);
  });

  test('caixa sem chave compatível: botão desabilitado com o motivo (title) e o atalho "Cadastrar chave"; só a caixa exige chave', () => {
    const actions = read('components', 'ItemActions.tsx');
    expect(actions).toMatch(/const needsKey = kind === 'CASE' && compatibleKeys === 0;/);
    expect(actions).toMatch(/disabled=\{needsKey\} title=\{reason\}/);
    expect(actions).toMatch(/needsKey && onRegisterKey && requiredKeyName/);
    expect(pt['inventory.actions.openNeedsKey']).toContain('{keyName}');
  });

  test('o atalho "Cadastrar chave" abre o cadastro em OUTRO com o nome sugerido', () => {
    const dialogs = read('components', 'ItemDialogs.tsx');
    expect(dialogs).toMatch(/openRegisterKey: \(keyName\) => setDialog\(\{ kind: 'registerKey', keyName \}\)/);
    expect(dialogs).toMatch(/kind === 'registerKey'/);
    expect(dialogs).toMatch(/keyName/);
  });

  test('a página de vendas não ganha o botão "Abrir" nem "Aplicar" (só o inventário)', () => {
    const sales = read('app', 'sales', 'page.tsx');
    expect(sales).not.toMatch(/openOpen|openApply/);
  });
});

describe('modal de abertura', () => {
  const modal = read('components', 'OpenContainerModal.tsx');

  test('"Comprar" fica sem permissão de enviar sem a loja Steam; "Não comprar" não depende dela; confirmação só no DECLINE', () => {
    expect(modal).toMatch(/\(decision === 'DECLINE' \|\| steamStore !== null\)/);
    expect(modal).toMatch(/isTerminal && decision === 'DECLINE'/);
    expect(modal.match(/<ConfirmDialog/g)).toHaveLength(1);
    expect(modal).toMatch(/decision === 'BUY' && !steamStore/);
  });

  test('a caixa exige a chave escolhida; a cotação só aparece em loja Steam fora de USD', () => {
    expect(modal).toMatch(/\(!isCase \|\| keyId !== null\)/);
    expect(modal).toMatch(/steamStore\.currency !== 'USD'/);
  });

  test('o modal chama openContainer e invalida item.open; o seletor da loja Steam invalida settings.steamStore', () => {
    expect(modal).toMatch(/openContainer\(/);
    expect(modal).toContain("invalidate('item.open')");
    expect(read('app', 'stores', 'page.tsx')).toContain("invalidate('settings.steamStore')");
  });
});

describe('invalidação executada', () => {
  test('item.open invalida itens, vendas, lojas, saldos, lucro real e importações', async () => {
    const client = new QueryClient();
    const samples = [
      queryKeys.items.list({}), queryKeys.sales.list({}), queryKeys.stores.all, queryKeys.storeBalances.current, queryKeys.profitSummary.all, queryKeys.imports.all,
    ];
    for (const key of samples) client.setQueryData(key, {});
    await invalidateAfter(client, 'item.open');
    expect(samples.map((key) => Boolean(client.getQueryState(key)?.isInvalidated))).toEqual([true, true, true, true, true, true]);
  });

  test('settings.steamStore invalida configurações, lojas e itens, e não mexe em saldos nem lucro real', async () => {
    const client = new QueryClient();
    const touched = [queryKeys.settings.all, queryKeys.stores.all, queryKeys.items.list({})];
    const untouched = [queryKeys.storeBalances.current, queryKeys.profitSummary.all];
    for (const key of [...touched, ...untouched]) client.setQueryData(key, {});
    await invalidateAfter(client, 'settings.steamStore');
    expect(touched.map((key) => Boolean(client.getQueryState(key)?.isInvalidated))).toEqual([true, true, true]);
    expect(untouched.map((key) => Boolean(client.getQueryState(key)?.isInvalidated))).toEqual([false, false]);
  });
});
