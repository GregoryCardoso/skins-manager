import { describe, expect, test } from 'vitest';
import { groupRowActions, rowActions } from './itemRowActions';
import { makeItem } from './testFixtures';
import type { ItemGroup, ItemView } from '@/types/api';

// QA da 12.5a: matriz de status/categoria/estado de venda de rowActions e limites de "Inspecionar".
const ids = (actions: { id: string }[]) => actions.map((action) => action.id);
const LOCKED = { isLocked: true, remainingMs: 1000, formatted: '1s', tradeUnlockAt: '2026-12-01T00:00:00.000Z' };
const comp = (detachable: boolean) => ({ id: 1, kind: detachable ? 'CHARM' : 'STICKER', detachable }) as unknown as ItemView['components'][number];
const openable = (kind: 'CASE' | 'CAPSULE' | 'PACKAGE' | 'TERMINAL', extra: Partial<NonNullable<ItemView['openable']>> = {}) =>
  ({ kind, compatibleKeys: 0, otherKeysInStock: 0, otherKeyNames: [], requiredKeyName: null, ...extra }) as NonNullable<ItemView['openable']>;

describe('rowActions: matriz de situações', () => {
  test('Excluir é sempre a última do menu e Editar e Histórico estão em toda situação', () => {
    const cases: ItemView[] = [
      makeItem(),
      makeItem({ tradeLock: LOCKED }),
      makeItem({ saleState: 'OFF_SALE' }),
      makeItem({ saleState: 'OFF_SALE', tradeLock: LOCKED }),
      makeItem({ status: 'VENDIDO', saleState: null }),
      makeItem({ status: 'CONSUMIDO', saleState: null }),
      makeItem({ acquisitionType: 'GERADO', status: 'CONSUMIDO', saleState: null }),
      makeItem({ category: 'CAIXA', openable: openable('CASE', { compatibleKeys: 1 }) }),
      makeItem({ components: [comp(true)], canReceiveComponents: true }),
    ];
    for (const item of cases) {
      const { menu } = rowActions(item);
      expect(menu[menu.length - 1].id).toBe('delete');
      expect(ids(menu)).toContain('history');
      expect(ids(menu)).toContain('edit');
    }
  });

  test('Vender aparece uma vez só e há uma só ação de venda/holding por situação', () => {
    for (const item of [makeItem(), makeItem({ saleState: 'OFF_SALE' }), makeItem({ tradeLock: LOCKED })]) {
      const { primary, menu } = rowActions(item);
      const all = [primary, ...menu].filter(Boolean).map((a) => a!.id);
      expect(all.filter((id) => id === 'sell')).toHaveLength(1);
      expect(all.filter((id) => id === 'offSale' || id === 'forSale')).toHaveLength(1);
    }
  });

  test('em estoque liberado: Vender habilitado, sem motivo, sem forSale nem unsell', () => {
    const { primary, menu } = rowActions(makeItem());
    expect(primary).toEqual({ id: 'sell' });
    expect(primary).not.toHaveProperty('disabled');
    expect(ids(menu)).not.toContain('forSale');
    expect(ids(menu)).not.toContain('unsell');
  });

  test('em trade lock, Mover para o holding continua disponível', () => {
    expect(ids(rowActions(makeItem({ tradeLock: LOCKED })).menu)).toContain('offSale');
  });

  test('vendido e consumido (inclusive GERADO) nunca têm Vender, holding, Aplicar, Abrir nem Inspecionar', () => {
    for (const status of ['VENDIDO', 'CONSUMIDO'] as const) {
      const item = makeItem({
        status, saleState: null, acquisitionType: 'GERADO', canReceiveComponents: true, components: [comp(true)],
        openable: openable('CASE', { compatibleKeys: 1 }), inspectLink: 'https://example.com/x',
      });
      const all = ids(rowActions(item).menu);
      for (const forbidden of ['sell', 'offSale', 'forSale', 'apply', 'detach', 'open', 'registerKey', 'inspect']) expect(all).not.toContain(forbidden);
    }
  });

  test('vendido tem Desfazer venda; consumido não', () => {
    expect(ids(rowActions(makeItem({ status: 'VENDIDO', saleState: null })).menu)).toContain('unsell');
    expect(ids(rowActions(makeItem({ status: 'CONSUMIDO', saleState: null })).menu)).not.toContain('unsell');
  });

  test('caixa com chave: Abrir habilitado; sem chave: desabilitado e Cadastrar chave logo depois; sem nome de chave não há Cadastrar', () => {
    const withKey = rowActions(makeItem({ category: 'CAIXA', openable: openable('CASE', { compatibleKeys: 2, requiredKeyName: 'K' }) })).menu;
    expect(withKey.find((a) => a.id === 'open')).toEqual({ id: 'open' });
    const noKey = rowActions(makeItem({ category: 'CAIXA', openable: openable('CASE', { requiredKeyName: 'K' }) })).menu;
    expect(ids(noKey).indexOf('registerKey')).toBe(ids(noKey).indexOf('open') + 1);
    const unknownKey = rowActions(makeItem({ category: 'CAIXA', openable: openable('CASE', { requiredKeyName: null }) })).menu;
    expect(unknownKey.find((a) => a.id === 'open')).toMatchObject({ disabled: true, disabledReason: 'NEEDS_KEY' });
    expect(ids(unknownKey)).not.toContain('registerKey');
  });

  test('cápsula, pacote e terminal: Abrir sempre habilitado, sem Cadastrar chave', () => {
    for (const kind of ['CAPSULE', 'PACKAGE', 'TERMINAL'] as const) {
      const menu = rowActions(makeItem({ openable: openable(kind, { requiredKeyName: 'ignorada' }) })).menu;
      expect(menu.find((a) => a.id === 'open')).toEqual({ id: 'open' });
      expect(ids(menu)).not.toContain('registerKey');
    }
  });

  test('chaveiro/slab separável dá Separar (também no holding); só sticker não', () => {
    expect(ids(rowActions(makeItem({ components: [comp(true)] })).menu)).toContain('detach');
    expect(ids(rowActions(makeItem({ components: [comp(false)] })).menu)).not.toContain('detach');
    expect(ids(rowActions(makeItem({ components: [comp(true)], saleState: 'OFF_SALE' })).menu)).toContain('detach');
  });

  test('ordem do menu no caso completo', () => {
    const item = makeItem({
      canReceiveComponents: true, components: [comp(true)], openable: openable('CASE', { requiredKeyName: 'K' }), inspectLink: 'https://a.b/c',
    });
    expect(ids(rowActions(item).menu)).toEqual(['edit', 'components', 'apply', 'detach', 'open', 'registerKey', 'offSale', 'inspect', 'history', 'delete']);
  });

  test('no holding a principal é forSale e o Vender é o primeiro do menu, sem offSale', () => {
    const { primary, menu } = rowActions(makeItem({ saleState: 'OFF_SALE', canReceiveComponents: true }));
    expect(primary).toEqual({ id: 'forSale' });
    expect(menu[0]).toEqual({ id: 'sell' });
    expect(ids(menu)).not.toContain('offSale');
  });
});

describe('rowActions: Inspecionar', () => {
  const hasInspect = (link: string | null) => ids(rowActions(makeItem({ inspectLink: link })).menu).includes('inspect');

  test('aceita https e steam:', () => {
    expect(hasInspect('https://example.com/inspect?x=1')).toBe(true);
    expect(hasInspect('steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20S1A1D1')).toBe(true);
  });

  test.each([[null], [''], ['http://example.com'], ['javascript:alert(1)'], ['data:text/html,x'], ['file:///c:/x'], ['ftp://x.y'], ['//example.com'], ['   ']])(
    'recusa %j',
    (link) => expect(hasInspect(link)).toBe(false),
  );
});

describe('groupRowActions: bordas', () => {
  const group = (units: ItemView[]): ItemGroup =>
    ({
      key: 'g', name: 'x', category: 'SKIN', variant: 'NORMAL', exterior: 'FT', phase: null, catalog: null, quantity: units.length,
      totalCostUsdCents: 0, avgCostUsdCents: 0, costUsesRecordedFx: false, approxCurrency: 'USD', approx: null, componentUnits: 0, stagnantCount: 0,
      stock: { total: units.length, forSale: 0, tradeLocked: 0, offSale: 0, nextUnlockAt: null }, units,
    }) as ItemGroup;

  test('só unidades no holding na aba À venda: Vender desabilitado por falta de unidade', () => {
    const { primary } = groupRowActions(group([makeItem({ id: 1, saleState: 'OFF_SALE' })]), 'FOR_SALE');
    expect(primary).toEqual({ id: 'sell', disabled: true, disabledReason: 'NO_SELLABLE_UNIT' });
  });

  test('grupo sem unidades: Vender desabilitado; aba Holding sem ação em lote: sem principal', () => {
    expect(groupRowActions(group([]), 'FOR_SALE').primary).toMatchObject({ disabled: true });
    expect(groupRowActions(group([makeItem({ id: 1 })]), 'OFF_SALE').primary).toBeNull();
  });

  test('unidade vendida ou consumida não conta como vendável', () => {
    const units = [makeItem({ id: 1, status: 'VENDIDO', saleState: null }), makeItem({ id: 2, status: 'CONSUMIDO', saleState: null })];
    expect(groupRowActions(group(units), 'FOR_SALE').primary).toMatchObject({ disabled: true, disabledReason: 'NO_SELLABLE_UNIT' });
  });
});
