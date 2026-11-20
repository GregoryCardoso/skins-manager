const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, createItemViaApi, purchaseBody } = require('../helpers/apiFixtures');
const CatalogItem = require('../../src/models/CatalogItem');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

const row = (id, o = {}) => ({
  id, source: 'SKINS', category: 'FACA', name: 'Zzkarambit | Crimson', namePtBr: null, nameKey: 'zzkarambit | crimson',
  searchText: 'zzkarambit | crimson', imageUrl: null, minFloat: 0.06, maxFloat: 0.8, hasStattrak: false, hasSouvenir: false,
  phase: null, rarity: null, ...o,
});

const search = (q) => request(app).get(`/api/catalog/search?q=${encodeURIComponent(q)}`);

describe('T51: busca colapsa entradas idênticas (D115)', () => {
  test('par idêntico aparece uma vez, representante com imagem; total conta grupos', async () => {
    CatalogItem.upsertMany([
      row('a-sem-imagem'),
      row('b-com-imagem', { imageUrl: 'https://img.test/b.png' }),
      row('c-com-imagem-maior-id', { imageUrl: 'https://img.test/c.png' }),
    ]);
    const res = await search('zzkarambit');
    expect(res.body.data.items.map((i) => i.id)).toEqual(['b-com-imagem']);
    expect(res.body.data.meta.total).toBe(1);
  });

  test('faixa de float diferente ou fase diferente não colapsam', async () => {
    CatalogItem.upsertMany([
      row('r1'),
      row('r2', { minFloat: 0, maxFloat: 0.08 }),
      row('p1', { name: 'Zzdoppler', nameKey: 'zzdoppler', searchText: 'zzdoppler', phase: 'Phase 1' }),
      row('p2', { name: 'Zzdoppler', nameKey: 'zzdoppler', searchText: 'zzdoppler', phase: 'Phase 2' }),
    ]);
    expect((await search('zzkarambit')).body.data.items).toHaveLength(2);
    const dop = await search('zzdoppler');
    expect(dop.body.data.items).toHaveLength(2);
    expect(dop.body.data.meta.total).toBe(2);
  });

  test('GET /:id do não representante continua funcionando e item vinculado a ele segue editável', async () => {
    CatalogItem.upsertMany([row('dup-a', { imageUrl: 'https://img.test/a.png' }), row('dup-b')]);
    expect((await request(app).get('/api/catalog/dup-b')).status).toBe(200);
    const item = await createItemViaApi(app, purchaseBody({ catalogId: 'dup-b' }));
    expect((await request(app).get(`/api/items/${item.id}`)).body.data.catalogId).toBe('dup-b');
    const patch = await request(app).patch(`/api/items/${item.id}`).send({ purchasePriceCents: 150 });
    expect(patch.status).toBe(200);
  });
});
