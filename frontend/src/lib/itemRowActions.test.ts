import { describe, expect, test } from 'vitest';
import { firstSellableUnit, groupRowActions, rowActions } from './itemRowActions';
import { makeItem } from './testFixtures';
import type { ItemGroup, ItemView } from '@/types/api';

const ids = (actions: { id: string }[]) => actions.map((action) => action.id);
const LOCKED = { isLocked: true, remainingMs: 3 * 86400000, formatted: '3d', tradeUnlockAt: '2026-12-01T00:00:00.000Z' };
const COMPONENT = { id: 1, kind: 'CHARM', detachable: true } as unknown as ItemView['components'][number];

describe('rowActions (unidade)', () => {
  test('em estoque, à venda e liberado: Vender e o menu na ordem do plano, com Excluir por último', () => {
    const { primary, menu } = rowActions(makeItem({ canReceiveComponents: true }));
    expect(primary).toEqual({ id: 'sell' });
    expect(ids(menu)).toEqual(['edit', 'apply', 'offSale', 'history', 'delete']);
  });

  test('sem canReceiveComponents não há "Aplicar do estoque"', () => {
    expect(ids(rowActions(makeItem({ canReceiveComponents: false })).menu)).not.toContain('apply');
  });

  test('em trade lock: Vender desabilitado com o motivo, e o menu é o mesmo', () => {
    const { primary, menu } = rowActions(makeItem({ tradeLock: LOCKED }));
    expect(primary).toEqual({ id: 'sell', disabled: true, disabledReason: 'TRADE_LOCK' });
    expect(ids(menu)).toEqual(['edit', 'apply', 'offSale', 'history', 'delete']);
  });

  test('no holding: a principal é Voltar para a venda e Vender vai para o menu (desabilitado em trade lock)', () => {
    const open = rowActions(makeItem({ saleState: 'OFF_SALE' }));
    expect(open.primary).toEqual({ id: 'forSale' });
    expect(ids(open.menu)).toEqual(['sell', 'edit', 'apply', 'history', 'delete']);
    const locked = rowActions(makeItem({ saleState: 'OFF_SALE', tradeLock: LOCKED }));
    expect(locked.menu[0]).toEqual({ id: 'sell', disabled: true, disabledReason: 'TRADE_LOCK' });
  });

  test('vendido: sem principal; Editar, Desfazer venda, Histórico e Excluir', () => {
    const { primary, menu } = rowActions(makeItem({ status: 'VENDIDO', saleState: null }));
    expect(primary).toBeNull();
    expect(ids(menu)).toEqual(['edit', 'unsell', 'history', 'delete']);
  });

  test('consumido: só Editar, Histórico e Excluir', () => {
    const { primary, menu } = rowActions(makeItem({ status: 'CONSUMIDO', saleState: null }));
    expect(primary).toBeNull();
    expect(ids(menu)).toEqual(['edit', 'history', 'delete']);
  });

  test('"Separar" só com pendurado separável; "Inspecionar" só com link seguro', () => {
    expect(ids(rowActions(makeItem({ components: [COMPONENT] })).menu)).toContain('detach');
    expect(ids(rowActions(makeItem()).menu)).not.toContain('detach');
    expect(ids(rowActions(makeItem({ inspectLink: 'steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20S1A1D1' })).menu)).toContain('inspect');
    expect(ids(rowActions(makeItem({ inspectLink: 'javascript:alert(1)' })).menu)).not.toContain('inspect');
    expect(ids(rowActions(makeItem({ inspectLink: 'not a link' })).menu)).not.toContain('inspect');
  });

  test('Inspecionar fica antes de Histórico', () => {
    const menu = ids(rowActions(makeItem({ inspectLink: 'https://example.com/inspect' })).menu);
    expect(menu.indexOf('inspect')).toBeLessThan(menu.indexOf('history'));
  });

  test('caixa: Abrir habilitado com chave; sem chave fica desabilitado e oferece Cadastrar chave', () => {
    const withKey = rowActions(makeItem({ openable: { kind: 'CASE', compatibleKeys: 1, otherKeysInStock: 0, otherKeyNames: [], requiredKeyName: 'Chroma Key' } }));
    expect(withKey.menu.find((a) => a.id === 'open')).toEqual({ id: 'open' });
    expect(ids(withKey.menu)).not.toContain('registerKey');

    const noKey = rowActions(makeItem({ openable: { kind: 'CASE', compatibleKeys: 0, otherKeysInStock: 0, otherKeyNames: [], requiredKeyName: 'Chroma Key' } }));
    expect(noKey.menu.find((a) => a.id === 'open')).toEqual({ id: 'open', disabled: true, disabledReason: 'NEEDS_KEY' });
    expect(ids(noKey.menu)).toContain('registerKey');

    const otherKeys = rowActions(makeItem({ openable: { kind: 'CASE', compatibleKeys: 0, otherKeysInStock: 2, otherKeyNames: ['x'], requiredKeyName: 'Chroma Key' } }));
    expect(otherKeys.menu.find((a) => a.id === 'open')).toMatchObject({ disabledReason: 'NEEDS_KEY_OTHER' });

    const terminal = rowActions(makeItem({ openable: { kind: 'TERMINAL', compatibleKeys: 0, otherKeysInStock: 0, otherKeyNames: [], requiredKeyName: null } }));
    expect(terminal.menu.find((a) => a.id === 'open')).toEqual({ id: 'open' });
  });
});

function makeGroup(units: ItemView[], overrides: Partial<ItemGroup> = {}): ItemGroup {
  return {
    key: 'g', name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', exterior: 'FT', phase: null, catalog: null,
    quantity: units.length, totalCostUsdCents: 0, avgCostUsdCents: 0, costUsesRecordedFx: false, approxCurrency: 'USD', approx: null,
    componentUnits: 0, stagnantCount: 0,
    stock: {
      total: units.length,
      forSale: units.filter((u) => u.saleState === 'FOR_SALE' && !u.tradeLock.isLocked).length,
      tradeLocked: units.filter((u) => u.tradeLock.isLocked).length,
      offSale: units.filter((u) => u.saleState === 'OFF_SALE').length,
      nextUnlockAt: null,
    },
    units,
    ...overrides,
  };
}

describe('groupRowActions', () => {
  test('aba À venda: Vender, e no menu Ver unidades e Mover para o holding', () => {
    const group = makeGroup([makeItem({ id: 1 }), makeItem({ id: 2 })]);
    const { primary, menu } = groupRowActions(group, 'FOR_SALE');
    expect(primary).toEqual({ id: 'sell' });
    expect(ids(menu)).toEqual(['viewUnits', 'bulkOffSale']);
  });

  test('todas em trade lock: Vender desabilitado', () => {
    const group = makeGroup([makeItem({ id: 1, tradeLock: LOCKED })]);
    expect(groupRowActions(group, 'FOR_SALE').primary).toEqual({ id: 'sell', disabled: true, disabledReason: 'NO_SELLABLE_UNIT' });
  });

  test('aba Holding: a principal volta o lote para a venda', () => {
    const group = makeGroup([makeItem({ id: 1, saleState: 'OFF_SALE' })]);
    const { primary, menu } = groupRowActions(group, 'OFF_SALE');
    expect(primary).toEqual({ id: 'bulkForSale' });
    expect(ids(menu)).toEqual(['viewUnits']);
  });

  test('firstSellableUnit: a primeira na ordem da API que não está em trade lock nem no holding', () => {
    const group = makeGroup([
      makeItem({ id: 1, tradeLock: LOCKED }),
      makeItem({ id: 2, saleState: 'OFF_SALE' }),
      makeItem({ id: 3 }),
      makeItem({ id: 4 }),
    ]);
    expect(firstSellableUnit(group)?.id).toBe(3);
    expect(firstSellableUnit(makeGroup([makeItem({ id: 1, tradeLock: LOCKED })]))).toBeNull();
  });
});
