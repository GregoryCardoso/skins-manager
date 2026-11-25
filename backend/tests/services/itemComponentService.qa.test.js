// 10.1: casos de borda adicionais das regras puras dos componentes (QA).
const svc = require('../../src/services/itemComponentService');

const CATALOG = {
  st1: { id: 'st1', category: 'STICKER', name: 'Sticker | Titan (Holo) | Katowice 2014' },
  st2: { id: 'st2', category: 'STICKER', name: 'Crown (Foil)' }, // sem o prefixo "Sticker | "
  long: { id: 'long', category: 'STICKER', name: `Sticker | ${'x'.repeat(300)}` },
  ch1: { id: 'ch1', category: 'PINGENTE', name: "Charm | Lil' Ava" },
  skin: { id: 'skin', category: 'SKIN', name: 'AK-47 | Redline' },
  agent: { id: 'agent', category: 'PERSONAGEM', name: 'Agente' },
  patch: { id: 'patch', category: 'PATCH', name: 'Patch | Crazy Banana' },
};
const find = (id) => CATALOG[id] ?? null;
const run = (input, category = 'SKIN', extra = {}) => svc.normalizeComponents(input, { category, findCatalogById: find, ...extra });
const codeOf = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.code;
  }
  return null;
};

describe('normalizeComponents: bordas', () => {
  test('não muda a lista de entrada e devolve objetos novos', () => {
    const input = [{ kind: 'STICKER', catalogId: 'st1', slot: 0 }];
    const frozen = JSON.parse(JSON.stringify(input));
    const out = run(input);
    expect(input).toEqual(frozen);
    expect(out[0]).not.toBe(input[0]);
  });

  test('valores nulos de slot, wear e pattern valem como ausentes', () => {
    const [row] = run([{ kind: 'STICKER', catalogId: 'st1', slot: null, wear: null, pattern: null }]);
    expect(row).toMatchObject({ slot: null, wear: null, pattern: null });
  });

  test('nome do slab sem o prefixo "Sticker | " fica "Sticker Slab | <nome>"; nome acima de 200 caracteres é cortado', () => {
    expect(run([{ kind: 'STICKER_SLAB', catalogId: 'st2' }])[0].name).toBe('Sticker Slab | Crown (Foil)');
    const [row] = run([{ kind: 'STICKER', catalogId: 'long' }]);
    expect(row.name).toHaveLength(200);
    const [slab] = run([{ kind: 'STICKER_SLAB', catalogId: 'long' }]);
    expect(slab.name).toHaveLength(200);
    expect(slab.name.startsWith('Sticker Slab | ')).toBe(true);
  });

  test('o parâmetro source é respeitado; origem e referências são sempre as de "veio com"', () => {
    const [row] = run([{ kind: 'CHARM', catalogId: 'ch1' }], 'SKIN', { source: 'CSFLOAT' });
    expect(row).toMatchObject({ source: 'CSFLOAT', origin: 'CAME_WITH', sourceItemId: null, operationId: null, purchaseReferenceCents: null });
  });

  test('elementos nulos, números e objetos sem kind na lista são INVALID_COMPONENT_FIELD', () => {
    expect(codeOf(() => run([null]))).toBe('INVALID_COMPONENT_FIELD');
    expect(codeOf(() => run([5]))).toBe('INVALID_COMPONENT_FIELD');
    expect(codeOf(() => run([{}]))).toBe('INVALID_COMPONENT_FIELD');
    expect(codeOf(() => run([{ kind: 'sticker', catalogId: 'st1' }]))).toBe('INVALID_COMPONENT_FIELD'); // diferencia maiúsculas
  });

  test('ordem das verificações: categoria antes de limite, limite antes dos campos, campos antes do catálogo', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ kind: 'STICKER', catalogId: 'nao-existe', slot: i }));
    expect(codeOf(() => run(six, 'FACA'))).toBe('COMPONENTS_NOT_ALLOWED');
    expect(codeOf(() => run(six))).toBe('COMPONENT_LIMIT_EXCEEDED');
    expect(codeOf(() => run([{ kind: 'STICKER', catalogId: 'nao-existe', wear: 2 }]))).toBe('INVALID_COMPONENT_FIELD');
    expect(codeOf(() => run([{ kind: 'STICKER', catalogId: 'nao-existe', slot: 0 }]))).toBe('COMPONENT_CATALOG_REQUIRED');
  });

  test('slot repetido vale (D361): os dois stickers no mesmo slot são mantidos, na ordem', () => {
    const rows = run([{ kind: 'STICKER', catalogId: 'st1', slot: 2 }, { kind: 'CHARM', catalogId: 'ch1' }, { kind: 'STICKER', catalogId: 'st1', slot: 2 }]);
    expect(rows.map((r) => [r.kind, r.slot])).toEqual([['STICKER', 2], ['CHARM', null], ['STICKER', 2]]);
  });

  test('pendurado: chaveiro e slab com slot 0 e sticker com slot 0 não colidem; dois pendurados com slot 0 já caem no limite', () => {
    expect(run([{ kind: 'STICKER', catalogId: 'st1', slot: 0 }, { kind: 'CHARM', catalogId: 'ch1', slot: 0 }])).toHaveLength(2);
    expect(codeOf(() => run([{ kind: 'CHARM', catalogId: 'ch1', slot: 0 }, { kind: 'STICKER_SLAB', catalogId: 'st1', slot: 0 }]))).toBe('COMPONENT_LIMIT_EXCEEDED');
  });

  test('patch: categoria PATCH do catálogo em PERSONAGEM é aceito; categoria errada é MISMATCH; limite de 3', () => {
    expect(run([{ kind: 'PATCH', catalogId: 'patch', slot: 0 }], 'PERSONAGEM')[0]).toMatchObject({ kind: 'PATCH', name: 'Patch | Crazy Banana' });
    expect(codeOf(() => run([{ kind: 'PATCH', catalogId: 'agent' }], 'PERSONAGEM'))).toBe('COMPONENT_CATALOG_MISMATCH');
    expect(codeOf(() => run(Array.from({ length: 4 }, (_, i) => ({ kind: 'PATCH', catalogId: 'patch', slot: i % 3 })), 'PERSONAGEM'))).toBe('COMPONENT_LIMIT_EXCEEDED');
    expect(codeOf(() => run([{ kind: 'PATCH', catalogId: 'patch', slot: 3 }], 'PERSONAGEM'))).toBe('INVALID_COMPONENT_FIELD');
  });

  test('wear e slot aceitam só números: strings, NaN e Infinity são recusados', () => {
    for (const bad of ['0.1', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(codeOf(() => run([{ kind: 'STICKER', catalogId: 'st1', wear: bad }]))).toBe('INVALID_COMPONENT_FIELD');
    }
    for (const bad of ['1', Number.NaN, 0.5]) {
      expect(codeOf(() => run([{ kind: 'STICKER', catalogId: 'st1', slot: bad }]))).toBe('INVALID_COMPONENT_FIELD');
    }
  });
});

describe('visões', () => {
  test('toView sem entrada no catálogo devolve imagem e nome pt-BR nulos, mantendo o nome gravado', () => {
    const [view] = svc.toView([{ id: 1, kind: 'STICKER', catalogId: 'sumiu', name: 'Sticker | Antigo', slot: 0, wear: 0.1, pattern: null, source: 'MANUAL', origin: 'CAME_WITH' }]);
    expect(view).toEqual({
      id: 1, kind: 'STICKER', catalogId: 'sumiu', name: 'Sticker | Antigo', namePtBr: null, imageUrl: null, slot: 0, wear: 0.1, pattern: null,
      source: 'MANUAL', origin: 'CAME_WITH', sourceItemId: null, operationId: null, undoable: false, scrapeable: false, detachable: false,
    });
  });

  test('toView sem catalogId (componente sem vínculo) não quebra', () => {
    const [view] = svc.toView([{ id: 2, kind: 'CHARM', catalogId: null, name: 'x', slot: null, wear: null, pattern: 5, source: 'CSFLOAT', origin: 'CAME_WITH' }]);
    expect(view).toMatchObject({ catalogId: null, imageUrl: null, namePtBr: null, source: 'CSFLOAT' });
  });

  test('toView não expõe campos internos (item, referência de compra); a origem do estoque aparece (D362)', () => {
    const [view] = svc.toView([{ id: 3, itemId: 9, kind: 'STICKER', catalogId: null, name: 'n', slot: 0, wear: null, pattern: null, source: 'MANUAL', origin: 'CAME_WITH', purchaseReferenceCents: 50, sourceItemId: null, operationId: null }]);
    expect(view).not.toHaveProperty('itemId');
    expect(view).not.toHaveProperty('purchaseReferenceCents');
    expect(view).toMatchObject({ operationId: null, sourceItemId: null, undoable: false, scrapeable: false });
  });

  test('toSummary e summarize aceitam lista vazia e ausente', () => {
    expect(svc.toSummary()).toEqual({ stickers: 0, charms: 0, patches: 0 });
    expect(svc.summarize([])).toEqual({ stickers: 0, hanging: 0, patches: 0, kinds: [] });
    expect(svc.summarize([{ kind: 'PATCH' }, { kind: 'PATCH' }])).toMatchObject({ patches: 2, kinds: ['PATCH'] });
  });

  test('allowedKindsFor: só SKIN e PERSONAGEM aceitam algo; o resto devolve lista vazia', () => {
    expect(svc.allowedKindsFor('SKIN')).toEqual(['STICKER', 'CHARM', 'STICKER_SLAB']);
    expect(svc.allowedKindsFor('PERSONAGEM')).toEqual(['PATCH']);
    for (const category of ['FACA', 'LUVA', 'CAIXA', 'CAPSULA', 'STICKER', 'PINGENTE', 'OUTRO', undefined]) {
      expect(svc.allowedKindsFor(category)).toEqual([]);
    }
  });

  test('assertExistingAllowed: componentes de SKIN em PERSONAGEM e patch em SKIN são recusados; o índice do primeiro inválido vai em params', () => {
    try {
      svc.assertExistingAllowed([{ kind: 'STICKER' }, { kind: 'PATCH' }], 'SKIN');
      throw new Error('devia ter lançado');
    } catch (e) {
      expect(e.code).toBe('COMPONENTS_NOT_ALLOWED');
      expect(e.params).toEqual({ index: 1, category: 'SKIN' });
    }
    expect(codeOf(() => svc.assertExistingAllowed([{ kind: 'CHARM' }], 'PERSONAGEM'))).toBe('COMPONENTS_NOT_ALLOWED');
  });
});
