'use strict';

// Correções da revisão da Etapa 4A: fase/exterior no PATCH, BOM no snapshot, validação do download,
// PASSE_BATALHA desvinculado e preservação do pt-BR no refresh.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { CATALOG_BASE_URL, CATALOG_MIN_ROWS } = require('../../src/config/constants');
const Item = require('../../src/models/Item');
const Setting = require('../../src/models/Setting');
const CatalogItem = require('../../src/models/CatalogItem');
const catalogService = require('../../src/services/catalogService');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, makeCatalogApp, CAT, NOW, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');
const { readFixture, importCatalogFixture } = require('../helpers/catalog');

const API_FIX = path.join(__dirname, '..', 'fixtures', 'csgo-api');
const FILES = ['skins', 'stickers', 'crates', 'keychains', 'agents'];

beforeEach(() => freshDb());
afterAll(() => closeDb());

const won = (o = {}) => ({ acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z', ...o });

function legacyItem(overrides = {}) {
  return Item.create({
    name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'),
    purchasePriceCents: 100, purchaseCurrency: 'USD', acquiredAt: '2026-11-10T12:00:00.000Z', ...overrides,
  });
}

describe('1. Fase limpa ao sair do catálogo/categoria de arma', () => {
  let app;
  beforeEach(() => {
    app = makeCatalogApp();
  });
  const patch = (id, body) => request(app).patch(`/api/items/${id}`).send(body);

  test('legado SKIN com fase -> OUTRO limpa a fase', async () => {
    const item = legacyItem({ name: 'Algo antigo', phase: 'Phase 2' });
    const res = await patch(item.id, { category: 'OUTRO', name: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ category: 'OUTRO', name: 'x', phase: null });
  });

  test('legado SKIN com fase -> OUTRO com fase no corpo -> ATTRIBUTES_NOT_ALLOWED', async () => {
    const item = legacyItem({ name: 'Algo antigo', phase: 'Phase 2' });
    expectError(await patch(item.id, { category: 'OUTRO', name: 'x', phase: 'Phase 1' }), 400, 'ATTRIBUTES_NOT_ALLOWED');
    expect(Item.findById(item.id).phase).toBe('Phase 2');
  });

  test('item vinculado com fase livre -> catalogId null + OUTRO limpa a fase', async () => {
    const created = await createItemViaApi(app, purchaseBody({ phase: 'Phase 3' }));
    expect(created.phase).toBe('Phase 3');
    const res = await patch(created.id, { catalogId: null, category: 'OUTRO', name: 'Livre' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ catalogId: null, category: 'OUTRO', phase: null });
  });

  test('item vinculado com fase livre -> OUTRO com fase no corpo -> ATTRIBUTES_NOT_ALLOWED', async () => {
    const created = await createItemViaApi(app, purchaseBody({ phase: 'Phase 3' }));
    expectError(await patch(created.id, { catalogId: null, category: 'OUTRO', name: 'Livre', phase: 'Phase 3' }), 400, 'ATTRIBUTES_NOT_ALLOWED');
  });

  test('legado de arma mantém a fase quando a categoria continua de arma', async () => {
    const item = legacyItem({ name: 'Algo antigo', phase: 'Phase 2' });
    const res = await patch(item.id, { paintSeed: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data.phase).toBe('Phase 2');
  });
});

describe('2. Exterior recalculado quando o float muda', () => {
  let app;
  let id;
  beforeEach(async () => {
    app = makeCatalogApp();
    const created = await createItemViaApi(app, purchaseBody({ floatValue: 0.2 }));
    id = created.id;
    expect(created.exterior).toBe('FT');
  });
  const patch = (body) => request(app).patch(`/api/items/${id}`).send(body);

  test('só floatValue: exterior é derivado de novo', async () => {
    const res = await patch({ floatValue: 0.5 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ floatValue: 0.5, exterior: 'BS' });
  });

  test('floatValue + exterior coerente é aceito; incoerente -> EXTERIOR_MISMATCH', async () => {
    expect((await patch({ floatValue: 0.5, exterior: 'BS' })).status).toBe(200);
    expectError(await patch({ floatValue: 0.12, exterior: 'BS' }), 400, 'EXTERIOR_MISMATCH');
  });

  test('exterior sozinho incoerente com o float gravado continua recusado', async () => {
    expectError(await patch({ exterior: 'BS' }), 400, 'EXTERIOR_MISMATCH');
  });

  test('floatValue: null descarta o exterior gravado', async () => {
    const res = await patch({ floatValue: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ floatValue: null, exterior: null });
  });
});

describe('3. BOM no catalog.json', () => {
  test('parseSnapshot e importSnapshot aceitam texto com BOM', () => {
    const text = `﻿${JSON.stringify(readFixture())}`;
    expect(catalogService.parseSnapshot(text).rows.length).toBeGreaterThan(0);
    expect(catalogService.importSnapshot(text, { now: NOW }).imported).toBeGreaterThan(0);
  });

  test('syncBundledCatalog importa arquivo com BOM', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-bom-'));
    try {
      const file = path.join(dir, 'catalog.json');
      fs.writeFileSync(file, `﻿${JSON.stringify(readFixture())}`, 'utf8');
      const result = catalogService.syncBundledCatalog({ now: NOW, snapshotPath: file });
      expect(result.error).toBeNull();
      expect(result.imported).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

function fixtureFetch(overrides = {}) {
  return async (url) => {
    const rel = url.slice(CATALOG_BASE_URL.length);
    if (Object.prototype.hasOwnProperty.call(overrides, rel)) {
      const o = overrides[rel];
      return typeof o === 'string' ? { ok: true, status: 200, text: async () => o } : o;
    }
    const [lang, file] = rel.split('/');
    if (!require('fs').existsSync(require('path').join(API_FIX, lang))) return { ok: false, status: 404, text: async () => '[]' }; // pasta de idioma não hospedada
    return { ok: true, status: 200, text: async () => fs.readFileSync(path.join(API_FIX, lang, file), 'utf8') };
  };
}
const readEn = (file) => JSON.parse(fs.readFileSync(path.join(API_FIX, 'en', `${file}.json`), 'utf8'));
const status404 = { ok: false, status: 404, text: async () => '[]' };

describe('4. Validação do conteúdo baixado', () => {
  // Fixture: SKINS 6 linhas válidas (facas, luva, faixas), 3 ignoradas no total.
  const lenient = { minRows: {}, maxSkippedRatio: 1, requireSkinShape: false };

  async function expectRejected(validation, overrides = {}) {
    importCatalogFixture();
    const before = { updatedAt: Setting.get().catalogUpdatedAt, counts: CatalogItem.countBySource() };
    const app = makeApp(NOW, { fetchFn: fixtureFetch(overrides), catalogValidation: validation });
    expectError(await request(app).post('/api/catalog/refresh').send({}), 502, 'CATALOG_INVALID_FORMAT');
    expect(Setting.get().catalogUpdatedAt).toBe(before.updatedAt);
    expect(CatalogItem.countBySource()).toEqual(before.counts);
  }

  test('valores padrão são os mínimos estritos por fonte', () => {
    expect(CATALOG_MIN_ROWS).toEqual({ SKINS: 1000, STICKERS: 1000, CRATES: 100, KEYCHAINS: 10, AGENTS: 10 });
  });

  test('padrão estrito rejeita o fixture pequeno (mínimos por fonte)', async () => {
    catalogService.setDefaultCatalogValidation(null);
    try {
      await expectRejected(undefined);
    } finally {
      catalogService.setDefaultCatalogValidation(lenient);
    }
  });

  test.each(['SKINS', 'STICKERS', 'CRATES', 'KEYCHAINS', 'AGENTS'])('fonte %s abaixo do mínimo -> 502 e nada gravado', async (source) => {
    await expectRejected({ ...lenient, minRows: { [source]: 1000 } });
  });

  test('en vazio em uma fonte (array vazio) com mínimo 1 -> 502', async () => {
    await expectRejected({ ...lenient, minRows: { AGENTS: 1 } }, { 'en/agents.json': '[]' });
  });

  test('skipped acima da fração -> 502; dentro da fração -> 200', async () => {
    await expectRejected({ ...lenient, maxSkippedRatio: 0.1 });
    const ok = makeApp(NOW, { fetchFn: fixtureFetch(), catalogValidation: { ...lenient, maxSkippedRatio: 0.2 } });
    expect((await request(ok).post('/api/catalog/refresh').send({})).status).toBe(200);
  });

  test('SKINS sem faca -> 502', async () => {
    const skins = readEn('skins').filter((e) => !(e.category && e.category.id === 'sfui_invpanel_filter_melee'));
    await expectRejected({ ...lenient, requireSkinShape: true }, { 'en/skins.json': JSON.stringify(skins) });
  });

  test('SKINS sem luva -> 502', async () => {
    const skins = readEn('skins').filter((e) => !(e.category && e.category.id === 'sfui_invpanel_filter_gloves'));
    await expectRejected({ ...lenient, requireSkinShape: true }, { 'en/skins.json': JSON.stringify(skins) });
  });

  test('SKINS sem nenhuma faixa de float -> 502', async () => {
    const skins = readEn('skins').map((e) => ({ ...e, min_float: null, max_float: null }));
    await expectRejected({ ...lenient, requireSkinShape: true }, { 'en/skins.json': JSON.stringify(skins) });
  });

  test('conteúdo bom passa com a forma exigida', async () => {
    const app = makeApp(NOW, { fetchFn: fixtureFetch(), catalogValidation: { ...lenient, requireSkinShape: true } });
    const res = await request(app).post('/api/catalog/refresh').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.catalogUpdatedAt).toBe(NOW.toISOString());
  });

  test('validateDownloadedCatalog e downloadCatalog aplicam a mesma regra (usada pelo buildCatalogSnapshot)', async () => {
    await expect(
      catalogService.downloadCatalog({ fetchFn: fixtureFetch(), validation: { ...lenient, minRows: { SKINS: 1000 } } })
    ).rejects.toMatchObject({ code: 'CATALOG_INVALID_FORMAT' });
    expect(() => catalogService.validateDownloadedCatalog({ rows: [], skipped: 0 }, lenient)).toThrow();
  });
});

describe('5. PASSE_BATALHA com catalogId: null', () => {
  test('desvincular sem renomear -> CATALOG_ITEM_REQUIRED e vínculo preservado', async () => {
    const app = makeCatalogApp();
    const item = await createItemViaApi(app, won({ catalogId: CAT.BATTLE_PASS_RIPTIDE }));
    expectError(await request(app).patch(`/api/items/${item.id}`).send({ catalogId: null }), 400, 'CATALOG_ITEM_REQUIRED');
    expect(Item.findById(item.id).catalogId).toBe(CAT.BATTLE_PASS_RIPTIDE);
  });

  test('PATCH sem relação com a identidade num PASSE_BATALHA livre antigo continua permitido', async () => {
    const app = makeCatalogApp();
    const item = legacyItem({ name: 'Operation Riptide Access Pass', category: 'PASSE_BATALHA', variant: null });
    const res = await request(app).patch(`/api/items/${item.id}`).send({ originDetail: 'x' });
    expect(res.status).toBe(200);
  });
});

describe('6. Nomes pt-BR preservados no refresh', () => {
  const ptNames = (id) => (CatalogItem.findNames([id], 'pt-BR')[0] || {}).name ?? null;

  test('pt-BR em 404: nome e busca em português continuam; en atualiza normalmente', async () => {
    importCatalogFixture();
    expect(ptNames(CAT.AK_REDLINE)).toBe('AK-47 | Linha Vermelha');
    const app = makeApp(NOW, { fetchFn: fixtureFetch(Object.fromEntries(FILES.map((f) => [`pt-BR/${f}.json`, status404]))) });
    expect((await request(app).post('/api/catalog/refresh').send({})).status).toBe(200);
    expect(ptNames(CAT.AK_REDLINE)).toBe('AK-47 | Linha Vermelha');
    const res = await request(app).get('/api/catalog/search').query({ q: 'linha vermelha' });
    expect(res.body.data.items.map((i) => i.id)).toContain(CAT.AK_REDLINE);
  });

  test('pt-BR presente numa fonte continua autoritativo para essa fonte', async () => {
    importCatalogFixture();
    const app = makeApp(NOW, { fetchFn: fixtureFetch() });
    await request(app).post('/api/catalog/refresh').send({});
    expect(ptNames(CAT.AK_REDLINE)).toBe(JSON.parse(fs.readFileSync(path.join(API_FIX, 'pt-BR', 'skins.json'), 'utf8')).find((e) => e.id === CAT.AK_REDLINE).name);
  });
});
