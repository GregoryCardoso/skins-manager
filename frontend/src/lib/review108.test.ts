// 10.8: correções da revisão da Etapa 10 no frontend (M1 custo efetivo da arma separada, M5 motivos do desfazer, M6 chaves que não
// servem, M7 botão "Separar" na seção de componentes, B7 dica do líquido). Verificações de fonte e de i18n; sem rede.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';

const SRC = path.resolve(__dirname, '..');
const read = (...parts: string[]) => fs.readFileSync(path.join(SRC, ...parts), 'utf8');
const get = (tree: unknown, key: string): string | undefined =>
  key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), tree) as string | undefined;

describe('M1: custo efetivo da arma depois de separar', () => {
  test('o custo da unidade mostra o efetivo sempre que difere do próprio (hasOperationCost), com a nota do valor separado', () => {
    const cell = read('components', 'inventory', 'UnitCells.tsx');
    expect(cell).toMatch(/item\.cost\.hasOperationCost \?\? inherited !== 0/);
    expect(cell).toMatch(/operations\.costSeparated/);
    expect(cell).not.toMatch(/inherited <= 0/);
  });

  test('a tabela de vendas usa o CostCell também quando o herdado é negativo', () => {
    expect(read('components', 'SalesTable.tsx')).toMatch(/inheritedCostUsdCents !== 0/);
  });

  test.each([['pt-BR', ptBR], ['en', en]])('nota "costSeparated" existe em %s e leva o valor', (_label, tree) => {
    expect(get(tree, 'operations.costSeparated')).toContain('{value}');
  });
});

describe('M5 e B6: textos dos motivos e erros neutros', () => {
  test.each([['pt-BR', ptBR], ['en', en]])('motivos novos do desfazer existem em %s', (_label, tree) => {
    for (const reason of ['COMPONENT_LIMIT', 'COMPONENTS_NOT_ALLOWED']) {
      expect(get(tree, `errorReasons.OPERATION_UNDO_BLOCKED_${reason}`)).toBeTruthy();
    }
  });

  test('GENERATED_FIELD_LOCKED, TARGET_SOLD e INVALID_OPERATION_INPUT não falam só de abertura ou de aplicação', () => {
    const texts = [
      get(ptBR, 'errors.GENERATED_FIELD_LOCKED'), get(ptBR, 'errors.INVALID_OPERATION_INPUT'), get(ptBR, 'errorReasons.OPERATION_UNDO_BLOCKED_TARGET_SOLD'),
      get(en, 'errors.GENERATED_FIELD_LOCKED'), get(en, 'errors.INVALID_OPERATION_INPUT'), get(en, 'errorReasons.OPERATION_UNDO_BLOCKED_TARGET_SOLD'),
    ];
    for (const text of texts) expect(text).toBeTruthy();
    expect(get(ptBR, 'errors.INVALID_OPERATION_INPUT')).not.toMatch(/abertura/i);
    expect(get(en, 'errors.INVALID_OPERATION_INPUT')).not.toMatch(/opening/i);
    expect(get(ptBR, 'errorReasons.OPERATION_UNDO_BLOCKED_TARGET_SOLD')).not.toMatch(/aplicação|arma/i);
  });
});

describe('M6: chaves em estoque que não servem', () => {
  test('o botão desabilitado usa o texto "as chaves em estoque não servem" quando há outras chaves', () => {
    const actions = read('components', 'inventory', 'ItemRowActions.tsx');
    expect(actions).toMatch(/reason === 'NEEDS_KEY_OTHER' \? 'inventory\.actions\.openNeedsKeyOther' : 'inventory\.actions\.openNeedsKey'/);
    expect(get(ptBR, 'inventory.actions.openNeedsKeyOther')).toMatch(/não servem/);
  });
});

describe('M7: "Separar" na seção de componentes', () => {
  test('o pendurado que veio junto e o aplicado separável têm o botão e abrem o mesmo modal com o id do componente', () => {
    const panel = read('components', 'item', 'ComponentsPanel.tsx');
    expect(panel).toMatch(/item && onDetach && cameWithHangingId !== null/);
    expect(panel).toMatch(/onDetach && item && component\.detachable/);
    expect(read('components', 'ItemDialogs.tsx')).toMatch(/<DetachComponentModal item=\{dialog\.item\} componentId=\{dialog\.componentId\}/);
    expect(read('components', 'DetachComponentModal.tsx')).toMatch(/c\.id === componentId/);
  });
});

describe('B5 e B7: dicas', () => {
  test.each([['pt-BR', ptBR], ['en', en]])('dica de agrupados menciona patches e a de líquido menciona a loja em US$ (%s)', (_label, tree) => {
    expect(get(tree, 'inventory.group.withComponentsHint')).toMatch(/patch/i);
    expect(get(tree, 'inventory.marketValue.netUnavailable.NET_NOT_COMPUTABLE')).toMatch(/US\$/);
  });
});
