// 10.1 (D343, D353): regras puras dos componentes aplicados.
const svc = require('../../src/services/itemComponentService');

const CATALOG = {
  st1: { id: 'st1', category: 'STICKER', name: 'Sticker | Titan (Holo) | Katowice 2014' },
  st2: { id: 'st2', category: 'STICKER', name: 'Sticker | Crown (Foil)' },
  ch1: { id: 'ch1', category: 'PINGENTE', name: 'Charm | Lil Ava' },
  skin: { id: 'skin', category: 'SKIN', name: 'AK-47 | Redline' },
};
const find = (id) => CATALOG[id] ?? null;
const run = (input, category = 'SKIN') => svc.normalizeComponents(input, { category, findCatalogById: find });
const code = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.code;
  }
  return null;
};

describe('normalizeComponents', () => {
  test('lista vazia vale em qualquer categoria; não-lista é recusada', () => {
    expect(run([], 'FACA')).toEqual([]);
    expect(code(() => run('x'))).toBe('INVALID_FIELD');
  });

  test('sticker, chaveiro e slab válidos: nome derivado do catálogo, origem e fonte fixas', () => {
    const rows = run([
      { kind: 'STICKER', catalogId: 'st1', slot: 0, wear: 0.25 },
      { kind: 'CHARM', catalogId: 'ch1', pattern: 123 },
    ]);
    expect(rows[0]).toMatchObject({
      kind: 'STICKER', name: CATALOG.st1.name, slot: 0, wear: 0.25, pattern: null, source: 'MANUAL', origin: 'CAME_WITH', sourceItemId: null, operationId: null,
    });
    expect(rows[1]).toMatchObject({ kind: 'CHARM', catalogId: 'ch1', pattern: 123, wear: null });
    const [slab] = run([{ kind: 'STICKER_SLAB', catalogId: 'st2', pattern: 7 }]);
    expect(slab.name).toBe('Sticker Slab | Crown (Foil)');
  });

  test.each(['FACA', 'LUVA', 'CAIXA', 'STICKER', 'PERSONAGEM'])('categoria %s recusa sticker', (category) => {
    expect(code(() => run([{ kind: 'STICKER', catalogId: 'st1' }], category))).toBe('COMPONENTS_NOT_ALLOWED');
  });

  test('limites: 6 stickers e 2 pendurados (chaveiro + slab)', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ kind: 'STICKER', catalogId: 'st1', slot: i }));
    expect(code(() => run(six))).toBe('COMPONENT_LIMIT_EXCEEDED');
    expect(run(six.slice(0, 5))).toHaveLength(5);
    expect(code(() => run([{ kind: 'CHARM', catalogId: 'ch1' }, { kind: 'STICKER_SLAB', catalogId: 'st1' }]))).toBe('COMPONENT_LIMIT_EXCEEDED');
    expect(code(() => run([{ kind: 'CHARM', catalogId: 'ch1' }, { kind: 'CHARM', catalogId: 'ch1' }]))).toBe('COMPONENT_LIMIT_EXCEEDED');
  });

  test('catálogo: obrigatório, inexistente e categoria errada', () => {
    expect(code(() => run([{ kind: 'STICKER' }]))).toBe('COMPONENT_CATALOG_REQUIRED');
    expect(code(() => run([{ kind: 'STICKER', catalogId: 'nao-existe' }]))).toBe('COMPONENT_CATALOG_REQUIRED');
    expect(code(() => run([{ kind: 'STICKER', catalogId: 'skin' }]))).toBe('COMPONENT_CATALOG_MISMATCH');
    expect(code(() => run([{ kind: 'CHARM', catalogId: 'st1' }]))).toBe('COMPONENT_CATALOG_MISMATCH');
    expect(code(() => run([{ kind: 'STICKER_SLAB', catalogId: 'ch1' }]))).toBe('COMPONENT_CATALOG_MISMATCH');
  });

  test('campos: wear só em sticker, pattern só nos pendurados, faixas e slot repetido', () => {
    expect(code(() => run([{ kind: 'CHARM', catalogId: 'ch1', wear: 0.1 }]))).toBe('INVALID_COMPONENT_FIELD');
    expect(code(() => run([{ kind: 'STICKER', catalogId: 'st1', pattern: 1 }]))).toBe('INVALID_COMPONENT_FIELD');
    expect(code(() => run([{ kind: 'STICKER', catalogId: 'st1', wear: 1 }]))).toBe('INVALID_COMPONENT_FIELD');
    expect(code(() => run([{ kind: 'STICKER', catalogId: 'st1', wear: -0.1 }]))).toBe('INVALID_COMPONENT_FIELD');
    expect(code(() => run([{ kind: 'STICKER', catalogId: 'st1', slot: 5 }]))).toBe('INVALID_COMPONENT_FIELD');
    expect(code(() => run([{ kind: 'CHARM', catalogId: 'ch1', pattern: 1000000 }]))).toBe('INVALID_COMPONENT_FIELD');
    expect(run([{ kind: 'STICKER', catalogId: 'st1', slot: 1 }, { kind: 'STICKER', catalogId: 'st2', slot: 1 }])).toHaveLength(2);
    expect(run([{ kind: 'STICKER', catalogId: 'st1', wear: 0 }, { kind: 'STICKER', catalogId: 'st1', wear: 0.99 }])).toHaveLength(2);
  });

  test('o índice do componente com erro vai em params.index', () => {
    expect.assertions(1);
    try {
      run([{ kind: 'STICKER', catalogId: 'st1' }, { kind: 'STICKER', catalogId: 'skin' }]);
    } catch (e) {
      expect(e.params.index).toBe(1);
    }
  });

  test('patch em agente exige um item PATCH do catálogo (D362); patch em skin é recusado', () => {
    expect(code(() => run([{ kind: 'PATCH', catalogId: 'st1' }], 'PERSONAGEM'))).toBe('COMPONENT_CATALOG_MISMATCH');
    expect(code(() => run([{ kind: 'PATCH', catalogId: 'st1' }], 'SKIN'))).toBe('COMPONENTS_NOT_ALLOWED');
  });
});

describe('auxiliares', () => {
  test('isDetachable', () => {
    expect(['STICKER', 'PATCH'].map(svc.isDetachable)).toEqual([false, false]);
    expect(['CHARM', 'STICKER_SLAB'].map(svc.isDetachable)).toEqual([true, true]);
  });

  test('assertExistingAllowed recusa a troca para categoria que não aceita os componentes gravados', () => {
    expect(() => svc.assertExistingAllowed([{ kind: 'STICKER' }], 'SKIN')).not.toThrow();
    expect(code(() => svc.assertExistingAllowed([{ kind: 'STICKER' }], 'FACA'))).toBe('COMPONENTS_NOT_ALLOWED');
    expect(() => svc.assertExistingAllowed([], 'FACA')).not.toThrow();
  });

  test('summarize e toSummary contam o pendurado (chaveiro ou slab)', () => {
    const rows = [{ kind: 'STICKER' }, { kind: 'STICKER' }, { kind: 'STICKER_SLAB' }];
    expect(svc.toSummary(rows)).toEqual({ stickers: 2, charms: 1, patches: 0 });
    expect(svc.summarize(rows).kinds).toEqual(['STICKER', 'STICKER_SLAB']);
  });

  test('toView traz imagem e nome pt-BR do catálogo', () => {
    const catalogById = new Map([['st2', { imageUrl: 'https://x/img.png', localizedName: 'Adesivo | Coroa' }]]);
    const [view] = svc.toView(
      [{ id: 9, kind: 'STICKER_SLAB', catalogId: 'st2', name: 'Sticker Slab | Crown', slot: null, wear: null, pattern: 3, source: 'MANUAL', origin: 'CAME_WITH' }],
      { catalogById }
    );
    expect(view).toMatchObject({ id: 9, imageUrl: 'https://x/img.png', localizedName: 'Sticker Slab | Coroa', pattern: 3 });
  });
});
