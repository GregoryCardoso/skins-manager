'use strict';

// 10.2 (D361): componentes do trade do CSFloat, funções puras. Fixtures montadas com a estrutura do exemplo real do usuário
// (anonimizado); sem banco e sem rede. Cobre o mapper (allowlist) e o `mapComponents` (catálogo, avisos e limites).
const { mapTrade } = require('../../src/services/imports/adapters/csfloatMapper');
const { mapComponents } = require('../../src/services/imports/externalItemMapper');
const { normalizeComponents } = require('../../src/services/itemComponentService');
const { normalizeSearchText } = require('../../src/services/catalog/csgoApiAdapter');
const {
  FAKE_ICON_HOST, fakeTrade, fakeSticker, fakeKeychain, DEAGLE_4_STICKERS, GLOCK_WEAR_OFFSET, M4A4_SAME_STICKER_TWICE, M4A1S_DUP_SLOT_WEAR1,
  GLOCK_ST_CHARM, SLAB_HYPOTHETICAL, KNIFE_WITH_STICKER, INVALID_VARIANTS, TRADE_PII, OTHER,
} = require('../helpers/csfloatFixtures');

const tradeOf = (preset) => mapTrade(fakeTrade({ id: '1', item: preset.item, reference: preset.reference })).trade;
const componentsOf = (preset) => tradeOf(preset).item.components;

// Catálogo em memória (sem banco): o mesmo contrato do `CatalogItem.findByNameKeyAnyCategory`.
const entry = (id, category, name, extra = {}) => ({ id, category, name, phase: null, ...extra });
const CATALOG = [
  entry('st-big', 'STICKER', 'Sticker | BIG (Holo) | 2020 RMR'),
  entry('st-heroic', 'STICKER', 'Sticker | Heroic (Foil) | 2020 RMR'),
  entry('st-nip', 'STICKER', 'Sticker | Ninjas in Pyjamas (Holo) | 2020 RMR'),
  entry('st-flit', 'STICKER', 'Sticker | FL1T (Champion) | Rio 2022'),
  entry('st-clavis', 'STICKER', 'Sticker | Clavis'),
  entry('st-boom', 'STICKER', 'Sticker | Boom | 2020 RMR'),
  entry('st-fly', 'STICKER', 'Sticker | Fly High'),
  entry('st-scavenger', 'STICKER', 'Sticker | Scavenger'),
  entry('st-flickshot', 'STICKER', 'Sticker | Flickshot'),
  entry('st-portal', 'STICKER', 'Sticker | Battlefield Portal'),
  entry('st-pixels', 'STICKER', 'Sticker | Separate Pixels'),
  entry('st-riptide', 'STICKER', 'Sticker | Operation Riptide'),
  entry('st-scales', 'STICKER', 'Sticker | Stone Scales'),
  entry('st-wisely', 'STICKER', 'Sticker | Choose Wisely'),
  entry('ch-teacup', 'PINGENTE', "Charm | Lil' Teacup"),
];
const finder = (catalog = CATALOG) => (key) => catalog.filter((c) => normalizeSearchText(c.name) === key);
const run = (raw, category = 'SKIN', catalog = CATALOG) => mapComponents(raw, { category, findByNameKeyAnyCategory: finder(catalog) });
const runPreset = (preset, category = 'SKIN', catalog = CATALOG) => run(componentsOf(preset), category, catalog);
const normalize = (components, category = 'SKIN', catalog = CATALOG) =>
  normalizeComponents(components, { category, source: 'CSFLOAT', findCatalogById: (id) => catalog.find((c) => c.id === id) || null });
const codes = (result) => result.warnings.map((w) => w.code);

describe('csfloatMapper: componentes do trade (allowlist)', () => {
  test('Desert Eagle com 4 stickers: nome, slot e desgaste 0 (sticker novo, sem `wear`); sem pattern', () => {
    expect(componentsOf(DEAGLE_4_STICKERS)).toEqual([
      { from: 'STICKER', name: 'Sticker | BIG (Holo) | 2020 RMR', slot: 0, wear: 0, pattern: null },
      { from: 'STICKER', name: 'Sticker | Heroic (Foil) | 2020 RMR', slot: 1, wear: 0, pattern: null },
      { from: 'STICKER', name: 'Sticker | Ninjas in Pyjamas (Holo) | 2020 RMR', slot: 2, wear: 0, pattern: null },
      { from: 'STICKER', name: 'Sticker | FL1T (Champion) | Rio 2022', slot: 3, wear: 0, pattern: null },
    ]);
  });

  test('o `wear` do CSFloat vale como fração (0.72); o chaveiro traz pattern e nunca desgaste', () => {
    expect(componentsOf(GLOCK_WEAR_OFFSET).map((c) => [c.slot, c.wear])).toEqual([[3, 0], [2, 0.72]]);
    expect(componentsOf(GLOCK_ST_CHARM).at(-1)).toEqual({ from: 'KEYCHAIN', name: "Charm | Lil' Teacup", slot: 0, wear: null, pattern: 84492 });
  });

  test('mesmo slot repetido e o sticker repetido são mantidos, na ordem do array', () => {
    expect(componentsOf(M4A4_SAME_STICKER_TWICE).map((c) => [c.name, c.slot])).toEqual([['Sticker | Fly High', 4], ['Sticker | Fly High', 3]]);
    expect(componentsOf(M4A1S_DUP_SLOT_WEAR1).map((c) => [c.slot, c.wear])).toEqual([[4, 1], [4, 0], [0, 0]]);
  });

  test('trade sem stickers nem chaveiros: lista vazia', () => {
    expect(tradeOf({ item: {}, reference: undefined }).item.components).toEqual([]);
  });

  test('variações inválidas nunca invalidam o trade', () => {
    expect(componentsOf(INVALID_VARIANTS.wearText)[0]).toMatchObject({ name: 'Sticker | Fly High', wear: null });
    expect(componentsOf(INVALID_VARIANTS.slotNine)[0]).toMatchObject({ slot: null });
    expect(componentsOf(INVALID_VARIANTS.emptyName)[0]).toMatchObject({ name: null, slot: 0 });
    expect(componentsOf(INVALID_VARIANTS.sevenStickers)).toHaveLength(7);
    expect(componentsOf(INVALID_VARIANTS.twoKeychains)).toHaveLength(2);
    // arrays como objeto/texto: ignorados
    expect(componentsOf(INVALID_VARIANTS.arraysAsObjects)).toEqual([]);
  });

  test('wear fora de [0, 1], negativo e infinito viram null; pattern fora da faixa vira null', () => {
    const preset = {
      item: {
        stickers: [fakeSticker(1, 0, 'Sticker | Fly High', { wear: 1.5 }), fakeSticker(2, 1, 'Sticker | Fly High', { wear: -0.1 }), fakeSticker(3, 2, 'Sticker | Fly High', { wear: null })],
        keychains: [fakeKeychain(4, 0, "Charm | Lil' Teacup", 1000000), fakeKeychain(5, 0, "Charm | Lil' Teacup", 'x')],
      },
    };
    expect(componentsOf(preset).map((c) => c.wear ?? c.pattern)).toEqual([null, null, 0, null, null]);
  });

  test('no máximo 10 de cada array são lidos', () => {
    const many = { item: { stickers: Array.from({ length: 15 }, (_, i) => fakeSticker(i, i % 5, 'Sticker | Fly High')) } };
    expect(componentsOf(many)).toHaveLength(10);
  });

  test('privacidade: nada fora da allowlist sai do mapper (busca recursiva)', () => {
    const presets = [DEAGLE_4_STICKERS, GLOCK_WEAR_OFFSET, M4A4_SAME_STICKER_TWICE, M4A1S_DUP_SLOT_WEAR1, GLOCK_ST_CHARM, SLAB_HYPOTHETICAL, KNIFE_WITH_STICKER];
    const text = JSON.stringify(presets.map(tradeOf));
    for (const forbidden of [
      'inspect_link', 'asset_id', 'serialized_inspect', 'gs_sig', 'cs2_screenshot', 'stickerId', 'icon_url', FAKE_ICON_HOST, 'icones-ficticios', 'offset_',
      'rotation', 'reference', 'base_price', 'predicted_price', 'sticker_overpay', 'keychain_price', 'sticker_index', 'keychain_index', 'keychain_pattern',
      '"stickers":', '"keychains":', 'float_factor', 'last_updated', 'quantity',
    ]) expect(text).not.toContain(forbidden);
    for (const value of TRADE_PII.filter((v) => v !== OTHER.steamId)) expect(text).not.toContain(value);
  });
});

describe('mapComponents: do trade para o catálogo do app', () => {
  test('4 stickers: tipo STICKER, catálogo casado, slots 0 a 3, desgaste 0, sem avisos; o resultado passa no normalizeComponents', () => {
    const result = runPreset(DEAGLE_4_STICKERS);
    expect(result.warnings).toEqual([]);
    expect(result.components).toEqual([
      { kind: 'STICKER', catalogId: 'st-big', slot: 0, wear: 0 },
      { kind: 'STICKER', catalogId: 'st-heroic', slot: 1, wear: 0 },
      { kind: 'STICKER', catalogId: 'st-nip', slot: 2, wear: 0 },
      { kind: 'STICKER', catalogId: 'st-flit', slot: 3, wear: 0 },
    ]);
    expect(normalize(result.components)).toHaveLength(4);
  });

  test('desgaste 0.72 é mantido', () => {
    const result = runPreset(GLOCK_WEAR_OFFSET);
    expect(result.components.map((c) => [c.catalogId, c.slot, c.wear])).toEqual([['st-clavis', 3, 0], ['st-boom', 2, 0.72]]);
  });

  test('o mesmo sticker duas vezes (slots 4 e 3): os dois, e o slot repetido é aceito', () => {
    const result = runPreset(M4A4_SAME_STICKER_TWICE);
    expect(result.components.map((c) => [c.catalogId, c.slot])).toEqual([['st-fly', 4], ['st-fly', 3]]);
    const dup = runPreset(M4A1S_DUP_SLOT_WEAR1);
    expect(normalize(dup.components)).toHaveLength(2); // dois no slot 4 não quebram o normalizeComponents
  });

  test('sticker com wear = 1 (raspado até o fim): não é registrado e gera COMPONENT_FULLY_SCRAPED (E-P2-Q46)', () => {
    const result = runPreset(M4A1S_DUP_SLOT_WEAR1);
    expect(result.warnings).toEqual([{ code: 'COMPONENT_FULLY_SCRAPED', name: 'Sticker | Scavenger' }]);
    expect(result.components.map((c) => [c.catalogId, c.slot])).toEqual([['st-flickshot', 4], ['st-portal', 0]]);
  });

  test('StatTrak com 4 stickers e o chaveiro: CHARM com pattern 84492, sem desgaste', () => {
    const result = runPreset(GLOCK_ST_CHARM);
    expect(result.warnings).toEqual([]);
    expect(result.components).toHaveLength(5);
    expect(result.components.at(-1)).toEqual({ kind: 'CHARM', catalogId: 'ch-teacup', slot: 0, pattern: 84492 });
    expect(result.components.slice(0, 4).every((c) => c.kind === 'STICKER' && c.wear === 0)).toBe(true);
    expect(normalize(result.components)).toHaveLength(5);
  });

  test('Sticker Slab (HIPÓTESE): procurado como "Sticker | X"; tipo STICKER_SLAB com pattern e sem desgaste', () => {
    const result = runPreset(SLAB_HYPOTHETICAL);
    expect(result.warnings).toEqual([]);
    expect(result.components).toEqual([{ kind: 'STICKER_SLAB', catalogId: 'st-fly', slot: 0, pattern: 321 }]);
    expect(normalize(result.components)[0]).toMatchObject({ kind: 'STICKER_SLAB', name: 'Sticker Slab | Fly High', wear: null, pattern: 321 });
  });

  test('slab cujo sticker não está no catálogo: aviso com o nome do slab, sem componente', () => {
    const raw = [{ from: 'KEYCHAIN', name: 'Sticker Slab | Fly Low', slot: 0, wear: null, pattern: 1 }];
    expect(run(raw)).toEqual({ components: [], warnings: [{ code: 'COMPONENT_CATALOG_NOT_FOUND', name: 'Sticker Slab | Fly Low' }] });
  });

  test('chaveiro de um tipo e sticker de outro não se misturam: "Charm | X" só casa com PINGENTE, "Sticker | X" só com STICKER', () => {
    const crossed = [entry('x1', 'STICKER', "Charm | Lil' Teacup")];
    expect(run([{ from: 'KEYCHAIN', name: "Charm | Lil' Teacup", slot: 0, wear: null, pattern: 1 }], 'SKIN', crossed).components).toEqual([]);
  });

  test('categoria que não aceita componentes (faca): descartado, com COMPONENTS_NOT_ALLOWED uma vez por item', () => {
    const result = runPreset(KNIFE_WITH_STICKER, 'FACA');
    expect(result.components).toEqual([]);
    expect(result.warnings).toEqual([{ code: 'COMPONENTS_NOT_ALLOWED', name: null }]);
    const many = runPreset(DEAGLE_4_STICKERS, 'LUVA');
    expect(many.warnings).toEqual([{ code: 'COMPONENTS_NOT_ALLOWED', name: null }]);
    expect(run(componentsOf(DEAGLE_4_STICKERS), 'OUTRO').components).toEqual([]);
  });

  test('patch: o nome "Patch | X" vira PATCH; sem PATCH no catálogo cai em COMPONENT_CATALOG_NOT_FOUND (agente) ou COMPONENTS_NOT_ALLOWED (arma)', () => {
    const raw = [{ from: 'STICKER', name: 'Patch | Phoenix', slot: 0, wear: 0, pattern: null }];
    expect(run(raw, 'PERSONAGEM')).toEqual({ components: [], warnings: [{ code: 'COMPONENT_CATALOG_NOT_FOUND', name: 'Patch | Phoenix' }] });
    expect(run(raw, 'SKIN')).toEqual({ components: [], warnings: [{ code: 'COMPONENTS_NOT_ALLOWED', name: null }] });
  });

  test('sticker fora do catálogo: aviso com o nome, sem bloquear os demais', () => {
    const raw = [
      { from: 'STICKER', name: 'Sticker | Inventado', slot: 0, wear: 0, pattern: null },
      { from: 'STICKER', name: 'Sticker | Fly High', slot: 1, wear: 0, pattern: null },
    ];
    const result = run(raw);
    expect(result.warnings).toEqual([{ code: 'COMPONENT_CATALOG_NOT_FOUND', name: 'Sticker | Inventado' }]);
    expect(result.components).toEqual([{ kind: 'STICKER', catalogId: 'st-fly', slot: 1, wear: 0 }]);
  });

  test('nome vazio no trade: aviso sem nome', () => {
    expect(runPreset(INVALID_VARIANTS.emptyName)).toEqual({ components: [], warnings: [{ code: 'COMPONENT_CATALOG_NOT_FOUND', name: null }] });
  });

  test('nome ambíguo no catálogo: entradas idênticas -> a de menor id; fases diferentes -> aviso', () => {
    const duplicated = [entry('st-b', 'STICKER', 'Sticker | Fly High'), entry('st-a', 'STICKER', 'Sticker | Fly High')];
    const raw = [{ from: 'STICKER', name: 'Sticker | Fly High', slot: 0, wear: 0, pattern: null }];
    expect(run(raw, 'SKIN', duplicated).components[0].catalogId).toBe('st-a');
    const phases = [entry('st-p1', 'STICKER', 'Sticker | Fly High', { phase: 'Phase 1' }), entry('st-p2', 'STICKER', 'Sticker | Fly High', { phase: 'Phase 2' })];
    expect(run(raw, 'SKIN', phases)).toEqual({ components: [], warnings: [{ code: 'COMPONENT_CATALOG_NOT_FOUND', name: 'Sticker | Fly High' }] });
  });

  test('7 stickers: ficam os 5 primeiros e o excedente gera COMPONENT_LIMIT_EXCEEDED (aviso, não erro)', () => {
    const result = runPreset(INVALID_VARIANTS.sevenStickers);
    expect(result.components).toHaveLength(5);
    expect(codes(result)).toEqual(['COMPONENT_LIMIT_EXCEEDED']);
    expect(normalize(result.components)).toHaveLength(5);
  });

  test('2 chaveiros: fica o primeiro; o outro gera COMPONENT_LIMIT_EXCEEDED. Chaveiro e slab juntos: o primeiro vence', () => {
    const result = runPreset(INVALID_VARIANTS.twoKeychains);
    expect(result.components).toEqual([{ kind: 'CHARM', catalogId: 'ch-teacup', slot: 0, pattern: 1 }]);
    expect(codes(result)).toEqual(['COMPONENT_LIMIT_EXCEEDED']);
    const mixed = run([
      { from: 'KEYCHAIN', name: 'Sticker Slab | Fly High', slot: 0, wear: null, pattern: 1 },
      { from: 'KEYCHAIN', name: "Charm | Lil' Teacup", slot: 0, wear: null, pattern: 2 },
    ]);
    expect(mixed.components.map((c) => c.kind)).toEqual(['STICKER_SLAB']);
    expect(codes(mixed)).toEqual(['COMPONENT_LIMIT_EXCEEDED']);
  });

  test('slot acima da faixa do tipo vira null (chaveiro no slot 3, sticker no slot 5)', () => {
    const result = run([
      { from: 'STICKER', name: 'Sticker | Fly High', slot: 5, wear: 0, pattern: null },
      { from: 'KEYCHAIN', name: "Charm | Lil' Teacup", slot: 3, wear: null, pattern: 7 },
      { from: 'STICKER', name: 'Sticker | Clavis', slot: null, wear: 0, pattern: null },
    ]);
    expect(result.components.map((c) => c.slot)).toEqual([null, null, null]);
    expect(normalize(result.components)).toHaveLength(3);
  });

  test('avisos: sem repetição e no máximo 10', () => {
    const raw = Array.from({ length: 12 }, (_, i) => ({ from: 'STICKER', name: `Sticker | Inventado ${i}`, slot: 0, wear: 0, pattern: null }));
    raw.push({ ...raw[0] });
    const result = run(raw);
    expect(result.warnings).toHaveLength(10);
    expect(new Set(result.warnings.map((w) => w.name)).size).toBe(10);
  });

  test('entrada vazia, nula ou inválida: nada, sem erro', () => {
    for (const input of [[], null, undefined, 'x', {}]) expect(run(input)).toEqual({ components: [], warnings: [] });
    expect(run([null, 5, {}])).toEqual({ components: [], warnings: [{ code: 'COMPONENT_CATALOG_NOT_FOUND', name: null }] });
  });
});
