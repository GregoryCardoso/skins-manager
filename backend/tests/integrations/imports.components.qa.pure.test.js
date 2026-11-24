'use strict';

// 10.2 (D361), QA: casos de borda do mapper (allowlist) e do `mapComponents`, sem banco e sem rede.
const { mapTrade } = require('../../src/services/imports/adapters/csfloatMapper');
const { mapComponents } = require('../../src/services/imports/externalItemMapper');
const { normalizeComponents } = require('../../src/services/itemComponentService');
const { normalizeSearchText } = require('../../src/services/catalog/csgoApiAdapter');
const { fakeTrade, fakeSticker, fakeKeychain, DEAGLE_4_STICKERS, GLOCK_ST_CHARM, KNIFE_WITH_STICKER, M4A1S_DUP_SLOT_WEAR1 } = require('../helpers/csfloatFixtures');

const AK = 'AK-47 | Redline (Field-Tested)';
const componentsFor = (item) => mapTrade(fakeTrade({ id: '1', item: { market_hash_name: AK, item_name: 'Redline', wear_name: 'Field-Tested', type: 'skin', float_value: 0.2, paint_seed: 1, ...item } })).trade.item.components;
const entry = (id, category, name, extra = {}) => ({ id, category, name, phase: null, ...extra });
const CATALOG = [
  ...Array.from({ length: 8 }, (_, i) => entry(`st-${i}`, 'STICKER', `Sticker | Item ${i}`)),
  entry('ch-1', 'PINGENTE', "Charm | Lil' Teacup"),
  entry('ch-2', 'PINGENTE', 'Charm | Other'),
  ...Array.from({ length: 5 }, (_, i) => entry(`pa-${i}`, 'PATCH', `Patch | Item ${i}`)),
];
const finder = (catalog = CATALOG) => (key) => catalog.filter((c) => normalizeSearchText(c.name) === key);
const run = (raw, category = 'SKIN', catalog = CATALOG) => mapComponents(raw, { category, findByNameKeyAnyCategory: finder(catalog) });
const st = (i, extra = {}) => ({ from: 'STICKER', name: `Sticker | Item ${i}`, slot: i % 5, wear: 0, pattern: null, ...extra });
const patch = (i) => ({ from: 'STICKER', name: `Patch | Item ${i}`, slot: 0, wear: 0, pattern: null });
const charm = (n = 'Charm | Lil\' Teacup', extra = {}) => ({ from: 'KEYCHAIN', name: n, slot: 0, wear: null, pattern: 1, ...extra });
const codes = (r) => r.warnings.map((w) => w.code);

describe('csfloatMapper: wear, slot, pattern e nome nos limites', () => {
  test('wear: ausente, null e 0 -> 0; 0.72 e 1 mantidos; fora de [0,1], texto, booleano, NaN e Infinity -> null', () => {
    const wears = [undefined, null, 0, 0.72, 1, 1.0000001, -0.0001, '0.5', true, NaN];
    const stickers = wears.map((wear, i) => fakeSticker(i, 0, 'Sticker | Item 0', wear === undefined ? {} : { wear }));
    expect(componentsFor({ stickers }).map((c) => c.wear)).toEqual([0, 0, 0, 0.72, 1, null, null, null, null, null]);
    const more = [Infinity, {}, [0.5]].map((wear, i) => fakeSticker(i, 0, 'Sticker | Item 0', { wear }));
    expect(componentsFor({ stickers: more }).map((c) => c.wear)).toEqual([null, null, null]);
  });

  test('slot: só inteiro seguro de 0 a 5; -1, 6, 1.5, texto, null, ausente e inteiro inseguro -> null', () => {
    const slots = [0, 5, -1, 6, 1.5, '2', null, undefined, Number.MAX_SAFE_INTEGER + 2, NaN];
    const stickers = slots.map((slot, i) => ({ ...fakeSticker(i, 0, 'Sticker | Item 0'), slot }));
    expect(componentsFor({ stickers }).map((c) => c.slot)).toEqual([0, 5, null, null, null, null, null, null, null, null]);
  });

  test('pattern: 0 e 999999 valem; -1, 1000000, 1.5, texto e ausente -> null; em sticker o pattern nunca é lido', () => {
    const patterns = [0, 999999, -1, 1000000, 1.5, '7', undefined];
    const keychains = patterns.map((p, i) => ({ ...fakeKeychain(i, 0, "Charm | Lil' Teacup", p), pattern: p }));
    expect(componentsFor({ keychains }).map((c) => c.pattern)).toEqual([0, 999999, null, null, null, null, null]);
    const [sticker] = componentsFor({ stickers: [{ ...fakeSticker(1, 0, 'Sticker | Item 0'), pattern: 55 }] });
    expect(sticker.pattern).toBeNull();
  });

  test('o desgaste num chaveiro nunca é lido (sempre null)', () => {
    const [c] = componentsFor({ keychains: [{ ...fakeKeychain(1, 0, "Charm | Lil' Teacup", 3), wear: 0.5 }] });
    expect(c.wear).toBeNull();
  });

  test('nome: não-texto, vazio, só espaços e acima de 200 caracteres -> null; com espaços nas pontas é aparado', () => {
    const names = [5, '', '   ', 'x'.repeat(201), '  Sticker | Item 0  ', 'x'.repeat(200)];
    const stickers = names.map((name, i) => ({ ...fakeSticker(i, 0, 'x'), name }));
    expect(componentsFor({ stickers }).map((c) => c.name)).toEqual([null, null, null, null, 'Sticker | Item 0', 'x'.repeat(200)]);
  });

  test('elementos que não são objetos são ignorados sem derrubar o trade', () => {
    const stickers = [null, 5, 'x', [1], undefined, fakeSticker(1, 2, 'Sticker | Item 0')];
    expect(componentsFor({ stickers })).toEqual([{ from: 'STICKER', name: 'Sticker | Item 0', slot: 2, wear: 0, pattern: null }]);
  });

  test('só as chaves da allowlist saem de cada componente, mesmo com campos extras e proibidos no cru', () => {
    const dirty = {
      ...fakeSticker(1, 0, 'Sticker | Item 0'), asset_id: 'A1', inspect_link: 'steam://rungame/730', serialized_inspect: 'S', gs_sig: 'G', cs2_screenshot_id: 'X', cs2_screenshot_at: 'Y',
    };
    const [c] = componentsFor({ stickers: [dirty], keychains: [{ ...fakeKeychain(2, 0, "Charm | Lil' Teacup", 3), asset_id: 'A2' }] });
    expect(Object.keys(c).sort()).toEqual(['from', 'name', 'pattern', 'slot', 'wear']);
    const all = componentsFor({ stickers: [dirty], keychains: [{ ...fakeKeychain(2, 0, "Charm | Lil' Teacup", 3), asset_id: 'A2' }] });
    for (const comp of all) expect(Object.keys(comp).sort()).toEqual(['from', 'name', 'pattern', 'slot', 'wear']);
    const text = JSON.stringify(all);
    for (const forbidden of ['A1', 'A2', 'steam://', 'serialized', 'gs_sig', 'screenshot', 'asset_id']) expect(text).not.toContain(forbidden);
  });

  test('o item mapeado não ganha nenhum campo proibido além de `components` (só campos conhecidos)', () => {
    const { item } = mapTrade(fakeTrade({ id: '1', item: GLOCK_ST_CHARM.item, reference: GLOCK_ST_CHARM.reference })).trade;
    const text = JSON.stringify(item);
    for (const forbidden of ['inspect_link', 'asset_id', 'serialized_inspect', 'gs_sig', 'cs2_screenshot', 'stickerId', 'offset_', 'reference', 'icon_url', 'rotation']) {
      expect(text).not.toContain(forbidden);
    }
    expect(item).toHaveProperty('components');
    expect(item).not.toHaveProperty('stickers');
    expect(item).not.toHaveProperty('keychains');
  });

  test('o trade inteiro (não só o item) não carrega o `contract.reference` nem os preços de referência', () => {
    const text = JSON.stringify(mapTrade(fakeTrade({ id: '1', item: DEAGLE_4_STICKERS.item, reference: DEAGLE_4_STICKERS.reference })).trade);
    for (const forbidden of ['predicted_price', 'base_price', 'sticker_overpay', 'float_factor', 'keychain_price', 'last_updated']) expect(text).not.toContain(forbidden);
  });

  test('o mapper não muda o objeto cru recebido', () => {
    const raw = fakeTrade({ id: '1', item: DEAGLE_4_STICKERS.item, reference: DEAGLE_4_STICKERS.reference });
    const copy = JSON.parse(JSON.stringify(raw));
    mapTrade(raw);
    expect(JSON.parse(JSON.stringify(raw))).toEqual(copy);
  });

  test('stickers e chaveiros vêm nessa ordem (stickers primeiro), cada array limitado a 10', () => {
    const out = componentsFor({
      keychains: [fakeKeychain(1, 0, "Charm | Lil' Teacup", 1)],
      stickers: Array.from({ length: 12 }, (_, i) => fakeSticker(i, 0, 'Sticker | Item 0')),
    });
    expect(out).toHaveLength(11);
    expect(out[10].from).toBe('KEYCHAIN');
  });
});

describe('mapComponents: bordas de limite, desgaste e aviso', () => {
  test('wear exatamente 1: não registra; wear 0.9999 registra; wear 1 sem catálogo gera só COMPONENT_FULLY_SCRAPED', () => {
    expect(run([st(0, { wear: 1 })])).toEqual({ components: [], warnings: [{ code: 'COMPONENT_FULLY_SCRAPED', name: 'Sticker | Item 0' }] });
    expect(run([st(0, { wear: 0.9999 })]).components).toEqual([{ kind: 'STICKER', catalogId: 'st-0', slot: 0, wear: 0.9999 }]);
    const ghost = run([{ from: 'STICKER', name: 'Sticker | Fantasma', slot: 0, wear: 1, pattern: null }]);
    expect(ghost.warnings).toEqual([{ code: 'COMPONENT_FULLY_SCRAPED', name: 'Sticker | Fantasma' }]);
  });

  test('wear null (inválido no mapper): o sticker é registrado sem a chave `wear` e passa no normalizeComponents', () => {
    const result = run([st(0, { wear: null })]);
    expect(result.components).toEqual([{ kind: 'STICKER', catalogId: 'st-0', slot: 0 }]);
    expect(result.components[0]).not.toHaveProperty('wear');
    const rows = normalizeComponents(result.components, { category: 'SKIN', source: 'CSFLOAT', findCatalogById: (id) => CATALOG.find((c) => c.id === id) });
    expect(rows).toHaveLength(1);
  });

  test('o raspado e o não encontrado NÃO consomem o limite de 5; só o registrado conta', () => {
    const raw = [st(0, { wear: 1 }), { from: 'STICKER', name: 'Sticker | Fantasma', slot: 0, wear: 0, pattern: null }, st(1), st(2), st(3), st(4), st(5)];
    const result = run(raw);
    expect(result.components).toHaveLength(5);
    expect(codes(result)).toEqual(['COMPONENT_FULLY_SCRAPED', 'COMPONENT_CATALOG_NOT_FOUND']);
  });

  test('exatamente 5 stickers: sem aviso; o 6º gera um único COMPONENT_LIMIT_EXCEEDED com o nome dele; repetir o mesmo nome não repete o aviso', () => {
    expect(codes(run([0, 1, 2, 3, 4].map((i) => st(i))))).toEqual([]);
    const six = run([0, 1, 2, 3, 4, 5].map((i) => st(i)));
    expect(six.warnings).toEqual([{ code: 'COMPONENT_LIMIT_EXCEEDED', name: 'Sticker | Item 5' }]);
    const again = run([0, 1, 2, 3, 4, 5, 5].map((i) => st(i)));
    expect(again.warnings).toEqual([{ code: 'COMPONENT_LIMIT_EXCEEDED', name: 'Sticker | Item 5' }]);
  });

  test('um chaveiro e um slab: só o 1º pendurado fica; o limite do pendurado não depende do slot', () => {
    const result = run([charm("Charm | Lil' Teacup", { slot: 0 }), charm('Charm | Other', { slot: 0 }), { from: 'KEYCHAIN', name: 'Sticker Slab | Item 1', slot: 0, wear: null, pattern: 2 }]);
    expect(result.components.map((c) => c.catalogId)).toEqual(['ch-1']);
    expect(result.warnings).toEqual([
      { code: 'COMPONENT_LIMIT_EXCEEDED', name: 'Charm | Other' },
      { code: 'COMPONENT_LIMIT_EXCEEDED', name: 'Sticker Slab | Item 1' },
    ]);
  });

  test('chaveiro/slab sem pattern válido: registrado sem a chave `pattern`', () => {
    const result = run([charm("Charm | Lil' Teacup", { pattern: null })]);
    expect(result.components).toEqual([{ kind: 'CHARM', catalogId: 'ch-1', slot: 0 }]);
    expect(result.components[0]).not.toHaveProperty('pattern');
  });

  test('slab nunca ganha `wear`, mesmo que o cru traga um', () => {
    const [slab] = run([{ from: 'KEYCHAIN', name: 'Sticker Slab | Item 3', slot: 0, wear: 0.4, pattern: 9 }]).components;
    expect(slab).toEqual({ kind: 'STICKER_SLAB', catalogId: 'st-3', slot: 0, pattern: 9 });
  });

  test('slab com nome vazio depois do prefixo, ou "Sticker Slab" vindo de stickers[]: não casa', () => {
    expect(codes(run([{ from: 'KEYCHAIN', name: 'Sticker Slab | ', slot: 0, wear: null, pattern: 1 }]))).toEqual(['COMPONENT_CATALOG_NOT_FOUND']);
    expect(codes(run([{ from: 'STICKER', name: 'Sticker Slab | Item 1', slot: 0, wear: 0, pattern: null }]))).toEqual(['COMPONENT_CATALOG_NOT_FOUND']);
  });

  test('patches em agente: até 3 registrados; o 4º gera COMPONENT_LIMIT_EXCEEDED; sticker em agente é recusado', () => {
    const result = run([0, 1, 2, 3].map(patch), 'PERSONAGEM');
    expect(result.components.map((c) => c.catalogId)).toEqual(['pa-0', 'pa-1', 'pa-2']);
    expect(result.warnings).toEqual([{ code: 'COMPONENT_LIMIT_EXCEEDED', name: 'Patch | Item 3' }]);
    expect(run([st(0)], 'PERSONAGEM')).toEqual({ components: [], warnings: [{ code: 'COMPONENTS_NOT_ALLOWED', name: null }] });
  });

  test('item que aceita componentes mas só tem tipo recusado: COMPONENTS_NOT_ALLOWED uma só vez, o resto segue', () => {
    const result = run([patch(0), patch(1), st(0)], 'SKIN');
    expect(result.warnings).toEqual([{ code: 'COMPONENTS_NOT_ALLOWED', name: null }]);
    expect(result.components.map((c) => c.catalogId)).toEqual(['st-0']);
  });

  test('faca e luva: nada é registrado, o aviso é único, mesmo com wear 1 e nomes fora do catálogo (não polui com avisos por nome)', () => {
    const raw = [st(0, { wear: 1 }), { from: 'STICKER', name: 'Sticker | Fantasma', slot: 0, wear: 0, pattern: null }, charm()];
    for (const category of ['FACA', 'LUVA', 'OUTRO', 'CAIXA']) {
      expect(run(raw, category)).toEqual({ components: [], warnings: [{ code: 'COMPONENTS_NOT_ALLOWED', name: null }] });
    }
  });

  test('o preset da faca com sticker passa por mapTrade + mapComponents como aviso (nunca erro)', () => {
    const raw = mapTrade(fakeTrade({ id: '1', item: KNIFE_WITH_STICKER.item, reference: KNIFE_WITH_STICKER.reference })).trade.item.components;
    expect(raw).toHaveLength(1);
    expect(run(raw, 'FACA').warnings).toEqual([{ code: 'COMPONENTS_NOT_ALLOWED', name: null }]);
  });

  test('o mesmo sticker no mesmo slot duas vezes: os dois entram (posicionamento livre)', () => {
    const result = run([st(0, { slot: 4 }), st(0, { slot: 4 })]);
    expect(result.components).toHaveLength(2);
    expect(result.components.map((c) => c.slot)).toEqual([4, 4]);
    expect(normalizeComponents(result.components, { category: 'SKIN', source: 'CSFLOAT', findCatalogById: (id) => CATALOG.find((c) => c.id === id) })).toHaveLength(2);
  });

  test('o mapeamento não muda a lista recebida nem os objetos dela', () => {
    const raw = Object.freeze([Object.freeze(st(0)), Object.freeze(charm())]);
    expect(() => run(raw)).not.toThrow();
  });

  test('é determinístico: duas chamadas com a mesma entrada dão o mesmo resultado', () => {
    const raw = mapTrade(fakeTrade({ id: '1', item: M4A1S_DUP_SLOT_WEAR1.item, reference: M4A1S_DUP_SLOT_WEAR1.reference })).trade.item.components;
    expect(run(raw)).toEqual(run(raw));
  });

  test('catálogo com a mesma entrada em categoria errada: ignorada (filtro por categoria do tipo)', () => {
    const wrong = [entry('x', 'PINGENTE', 'Sticker | Item 0')];
    expect(codes(run([st(0)], 'SKIN', wrong))).toEqual(['COMPONENT_CATALOG_NOT_FOUND']);
  });
});
