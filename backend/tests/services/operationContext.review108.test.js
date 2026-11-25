// 10.8 (B4, M5): regras puras do desfazer no operationContext. Sem banco.
const { weaponLinkOf, isHangingOccupied, assessUndo } = require('../../src/services/operations/operationContext');

describe('B4: HANGING_OCCUPIED numa função única', () => {
  test('isHangingOccupied: só o pendurado (chaveiro ou slab) ocupa o lugar', () => {
    expect(isHangingOccupied([])).toBe(false);
    expect(isHangingOccupied([{ kind: 'STICKER' }, { kind: 'PATCH' }])).toBe(false);
    expect(isHangingOccupied([{ kind: 'STICKER' }, { kind: 'CHARM' }])).toBe(true);
    expect(isHangingOccupied([{ kind: 'STICKER_SLAB' }])).toBe(true);
  });

  test('weaponLinkOf usa o weaponItemId do detalhe, não o 1.º vínculo TARGET', () => {
    const links = [{ role: 'TARGET', itemId: 7 }, { role: 'TARGET', itemId: 9 }, { role: 'CREATED', itemId: 11 }];
    expect(weaponLinkOf(links, { weaponItemId: 9 })).toBe(links[1]);
    expect(weaponLinkOf(links, {})).toBe(links[0]); // registro sem detalhe: o primeiro TARGET
    expect(weaponLinkOf([{ role: 'CREATED', itemId: 1 }], {})).toBeNull();
  });

  test('assessUndo da separação consulta a arma do detalhe', () => {
    const operation = { id: 5, kind: 'DETACH_COMPONENT', undoneAt: null, endedByOperationId: null, detailJson: JSON.stringify({ weaponItemId: 9 }) };
    const links = [{ role: 'TARGET', itemId: 7 }, { role: 'TARGET', itemId: 9 }, { role: 'CREATED', itemId: 11 }];
    const items = new Map([[7, { id: 7, status: 'EM_ESTOQUE' }], [9, { id: 9, status: 'EM_ESTOQUE' }], [11, { id: 11, status: 'EM_ESTOQUE' }]]);
    const base = { linksByOperation: new Map([[5, links]]), latestOpIdByItem: new Map(), itemsById: items };
    const rows = { 7: [{ kind: 'CHARM' }], 9: [] };
    // o 1.º TARGET (7) tem pendurado, mas a arma do detalhe (9) não: pode desfazer
    expect(assessUndo(operation, { ...base, componentRowsOf: (id) => rows[id] ?? [] })).toMatchObject({ undoable: true });
    const occupied = assessUndo(operation, { ...base, componentRowsOf: (id) => (id === 9 ? [{ kind: 'STICKER_SLAB' }] : []) });
    expect(occupied).toEqual({ undoable: false, reason: 'HANGING_OCCUPIED', params: { itemId: 9 } });
  });
});
