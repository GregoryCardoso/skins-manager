// 12.5b (D370): filtro aditivo `search` e `meta.position` nas listas individual e agrupada. Banco :memory: novo a cada teste, relógio fixo.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError, NOW, CAT } = require('../helpers/apiFixtures');
const { normalizeInventorySearch, matchesInventorySearch } = require('../../src/services/inventoryPositionService');

let app;
beforeEach(() => { freshDb(); app = makeCatalogApp(); });
afterAll(() => closeDb());

const DAY = 86400000;
const iso = (days) => new Date(NOW.getTime() + days * DAY).toISOString();
const groups = async (query = '') => (await request(app).get(`/api/items/groups${query}`)).body.data;
const list = async (query = '') => (await request(app).get(`/api/items${query}`)).body.data;
const create = (overrides = {}) => createItemViaApi(app, purchaseBody({ acquiredAt: iso(-40), ...overrides }));
const offSale = (id) => request(app).post(`/api/items/${id}/off-sale`).send({});
const setName = (catalogId, language, name) => getDb().prepare('INSERT OR REPLACE INTO catalog_item_names (catalog_id, language, name) VALUES (?, ?, ?)').run(catalogId, language, name);

describe('normalizeInventorySearch e matchesInventorySearch (puras)', () => {
  test('sem acento, sem caixa e com o ı/İ turco', () => {
    expect(normalizeInventorySearch('  Ağır  İŞ ')).toBe('agir is');
    expect(normalizeInventorySearch('ISPARTA')).toBe('isparta');
    expect(normalizeInventorySearch('ısparta')).toBe('isparta');
    expect(normalizeInventorySearch('İstanbul')).toBe('istanbul');
    expect(normalizeInventorySearch('★ Karambit')).toBe('karambit');
    expect(normalizeInventorySearch('Linha Vermelha ção')).toBe('linha vermelha cao');
  });

  test('"contém" sobre o nome canônico e o traduzido; consulta vazia casa com tudo', () => {
    const item = { name: 'AK-47 | Redline' };
    expect(matchesInventorySearch(item, null, normalizeInventorySearch('redl'))).toBe(true);
    expect(matchesInventorySearch(item, 'AK-47 | Linha Vermelha', normalizeInventorySearch('vermelha'))).toBe(true);
    expect(matchesInventorySearch(item, 'AK-47 | Linha Vermelha', normalizeInventorySearch('awp'))).toBe(false);
    expect(matchesInventorySearch(item, null, '')).toBe(true);
  });
});

describe('search em GET /api/items e GET /api/items/groups', () => {
  test('filtra pelo nome canônico (sem acento e sem caixa), nas duas listas', async () => {
    await create();
    await create({ catalogId: CAT.AWP_DLORE });
    for (const q of ['redline', 'REDLINE', 'ak-47', '  ak  ']) {
      const flat = await list(`?search=${encodeURIComponent(q)}`);
      expect(flat.items.map((i) => i.catalog.id)).toEqual([CAT.AK_REDLINE]);
      expect(flat.meta.count).toBe(1);
      const grouped = await groups(`?search=${encodeURIComponent(q)}`);
      expect(grouped.groups).toHaveLength(1);
      expect(grouped.meta).toMatchObject({ count: 1, groupCount: 1 });
    }
    expect((await list('?search=zzz')).items).toEqual([]);
  });

  test('casa com o nome traduzido no idioma das configurações (com acento ou sem)', async () => {
    await create();
    await create({ catalogId: CAT.AWP_DLORE });
    Setting.update({ language: 'pt-BR' });
    expect((await list('?search=linha%20vermelha')).items).toHaveLength(1);
    expect((await list('?search=LINHA%20VERMELHA')).items).toHaveLength(1);
    // em outro idioma, o nome pt-BR deixa de valer (só o canônico e o do idioma atual)
    Setting.update({ language: 'es' });
    expect((await list('?search=linha%20vermelha')).items).toHaveLength(0);
    expect((await list('?search=redline')).items).toHaveLength(1);
  });

  test('turco: İ e ı casam com i, nos dois sentidos', async () => {
    await create({ catalogId: CAT.AWP_DLORE });
    setName(CAT.AWP_DLORE, 'tr', 'AWP | İstanbul Işığı');
    Setting.update({ language: 'tr' });
    for (const q of ['istanbul', 'İSTANBUL', 'ışığı', 'isigi', 'ISIĞI']) {
      expect((await list(`?search=${encodeURIComponent(q)}`)).items).toHaveLength(1);
    }
    expect((await list('?search=istanbulx')).items).toHaveLength(0);
  });

  test('junto com a categoria, as abas e as contagens (saleStateCounts respeita a busca)', async () => {
    const a = await create();
    const b = await create();
    await create({ catalogId: CAT.AWP_DLORE });
    await create({ catalogId: CAT.STICKER_TITAN, purchasePriceCents: 50 });
    await offSale(b.id);
    const both = await list('?search=ak&category=SKIN&status=EM_ESTOQUE');
    expect(both.items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
    expect(both.meta.saleStateCounts).toEqual({ forSale: 1, offSale: 1 });
    const none = await list('?search=ak&category=STICKER');
    expect(none.items).toEqual([]);
    expect(none.meta.saleStateCounts).toEqual({ forSale: 0, offSale: 0 });
    const tab = await list('?search=ak&status=EM_ESTOQUE&saleState=OFF_SALE');
    expect(tab.items.map((i) => i.id)).toEqual([b.id]);
    expect(tab.meta.saleStateCounts).toEqual({ forSale: 1, offSale: 1 });
    const stag = await groups('?search=ak&stagnantOnly=true');
    expect(stag.groups).toHaveLength(1);
    expect(stag.groups[0].units.map((u) => u.id)).toEqual([a.id]);
  });

  test('o stock do grupo continua independente da busca (a busca só escolhe os grupos)', async () => {
    await create();
    await create();
    const data = await groups('?search=redline');
    expect(data.groups[0].stock.total).toBe(2);
    expect(data.groups[0].quantity).toBe(2);
  });

  test('vazio, só espaços e mais de 100 caracteres são recusados; 100 passa', async () => {
    for (const url of ['/api/items', '/api/items/groups']) {
      expectError(await request(app).get(`${url}?search=`), 400, 'INVALID_QUERY', { field: 'search' });
      expectError(await request(app).get(`${url}?search=%20%20`), 400, 'INVALID_QUERY', { field: 'search' });
      expectError(await request(app).get(`${url}?search=${'a'.repeat(101)}`), 400, 'INVALID_QUERY', { field: 'search' });
      expectError(await request(app).get(`${url}?search=a&search=b`), 400, 'INVALID_QUERY', { field: 'search' });
      expect((await request(app).get(`${url}?search=${'a'.repeat(100)}`)).status).toBe(200);
    }
  });
});

describe('meta.position', () => {
  test('inventário vazio: zerado, sem "≈" com USD', async () => {
    const data = await list();
    expect(data.meta.position).toEqual({
      forSale: { costUsdCents: 0, costUsesRecordedFx: false, approx: null },
      offSale: { costUsdCents: 0, costUsesRecordedFx: false, approx: null },
      tradeLocked: { units: 0, nextUnlockAt: null },
      stagnant: { units: 0, groups: 0 },
    });
  });

  test('custos à venda e no holding somam o stockUsdCents do lucro real; "≈" pela moeda de conversão', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: NOW });
    await create({ purchasePriceCents: 500 });
    await create({ purchasePriceCents: 300 });
    const h = await create({ purchasePriceCents: 700 });
    await offSale(h.id);
    const sold = await create({ purchasePriceCents: 400 });
    await request(app).post(`/api/items/${sold.id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 800, soldAt: NOW.toISOString() });
    const profit = (await request(app).get('/api/profit/summary')).body.data;
    const { position } = (await list()).meta;
    expect(position.forSale.costUsdCents).toBe(800);
    expect(position.offSale.costUsdCents).toBe(700);
    expect(position.forSale.costUsdCents + position.offSale.costUsdCents).toBe(profit.stockUsdCents);
    expect(position.forSale.costUsdCents).toBe(profit.stockBreakdown.forSale.usdCents);
    expect(position.offSale.costUsdCents).toBe(profit.stockBreakdown.offSale.usdCents);
    expect(position.forSale.approx).toEqual({ currency: profit.approxCurrency, cents: profit.stockBreakdown.forSale.approx });
    expect(position.offSale.approx).toEqual({ currency: profit.approxCurrency, cents: profit.stockBreakdown.offSale.approx });
  });

  test('independe dos filtros, da aba, da categoria e da busca; igual nas duas listas', async () => {
    await create({ purchasePriceCents: 500 });
    await create({ catalogId: CAT.AWP_DLORE, purchasePriceCents: 300 });
    const h = await create({ purchasePriceCents: 700 });
    await offSale(h.id);
    const base = (await list()).meta.position;
    for (const q of ['?status=VENDIDO', '?category=STICKER', '?search=awp', '?saleState=OFF_SALE&status=EM_ESTOQUE', '?stagnantOnly=true', '?search=zzz']) {
      expect((await list(q)).meta.position).toEqual(base);
    }
    for (const q of ['', '?category=STICKER', '?search=awp', '?saleState=OFF_SALE', '?stagnantOnly=true']) {
      expect((await groups(q)).meta.position).toEqual(base);
    }
  });

  test('trade lock: conta as unidades à venda em lock e a próxima liberação; holding em lock não conta', async () => {
    await create({ tradeUnlockAt: iso(5) });
    await create({ tradeUnlockAt: iso(2) });
    const h = await create({ tradeUnlockAt: iso(1) });
    await offSale(h.id);
    const { position } = (await list()).meta;
    expect(position.tradeLocked).toEqual({ units: 2, nextUnlockAt: iso(2) });
  });

  test('encalhados: só à venda e liberados; holding e trade lock nunca entram; grupos = chaves distintas', async () => {
    await create({ acquiredAt: iso(-40) });
    await create({ acquiredAt: iso(-30) });
    await create({ catalogId: CAT.AWP_DLORE, acquiredAt: iso(-25) });
    await create({ acquiredAt: iso(-5) }); // recente: não é encalhado
    await create({ acquiredAt: iso(-60), tradeUnlockAt: iso(3) }); // em trade lock: não entra
    const h = await create({ acquiredAt: iso(-90) });
    await offSale(h.id);
    const { position } = (await list()).meta;
    expect(position.stagnant).toEqual({ units: 3, groups: 2 });
  });

  test('vendido não entra em nenhuma parte', async () => {
    const item = await create({ purchasePriceCents: 400 });
    await request(app).post(`/api/items/${item.id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 800, soldAt: NOW.toISOString() });
    const { position } = (await list()).meta;
    expect(position.forSale.costUsdCents + position.offSale.costUsdCents).toBe(0);
    expect(position.stagnant).toEqual({ units: 0, groups: 0 });
  });

  test('a lista de vendas não traz position', async () => {
    const data = (await request(app).get('/api/items/sales')).body.data;
    expect(data.meta.position).toBeUndefined();
  });
});

describe('QA 12.5b: curingas, idiomas e combinações', () => {
  test('%, _ e \ são texto literal (nada de curinga do LIKE)', async () => {
    await create();
    await create({ catalogId: CAT.AWP_DLORE });
    for (const q of ['%', '_', 'a%', '%ak', 'a_-47', String.fromCharCode(92), "' OR 1=1 --"]) {
      expect((await list(`?search=${encodeURIComponent(q)}`)).items).toEqual([]);
      expect((await groups(`?search=${encodeURIComponent(q)}`)).groups).toEqual([]);
    }
    // um nome traduzido com % e _ literais casa só pelo texto
    setName(CAT.AK_REDLINE, 'pt-BR', 'AK-47 | 100% Vermelha_X');
    Setting.update({ language: 'pt-BR' });
    expect((await list(`?search=${encodeURIComponent('100%')}`)).items).toHaveLength(1);
    expect((await list(`?search=${encodeURIComponent('a_y')}`)).items).toHaveLength(0);
    expect((await list(`?search=${encodeURIComponent('_x')}`)).items).toHaveLength(1);
  });

  test('acentos na consulta e no nome, em vários idiomas (pt-BR, es, de, fr, ru, ja)', async () => {
    await create();
    const names = {
      'pt-BR': ['AK-47 | Linha Vermelha Ção', 'linha vermelha cao'],
      es: ['AK-47 | Línea Roja Ñandú', 'LINEA ROJA NANDU'],
      de: ['AK-47 | Rötlich Größe', 'rotlich grosse'],
      fr: ['AK-47 | Écarlate Crème', 'ecarlate creme'],
      ru: ['AK-47 | Красная линия', 'КРАСНАЯ ЛИНИЯ'],
      ja: ['AK-47 | レッドライン', 'レッドライン'],
    };
    for (const [language, [name, query]] of Object.entries(names)) {
      setName(CAT.AK_REDLINE, language, name);
      Setting.update({ language });
      const res = await request(app).get(`/api/items?search=${encodeURIComponent(query)}`);
      // de: "ß" vira "ss" na normalização, então "grosse" acha "Größe".
      expect(res.body.data.items).toHaveLength(1);
      // com acento na consulta também casa
      const exact = await request(app).get(`/api/items?search=${encodeURIComponent(name.split('| ')[1])}`);
      expect(exact.body.data.items).toHaveLength(1);
    }
  });

  test('nome traduzido ausente no idioma atual: só o canônico vale; idioma sem catálogo traduzido não quebra', async () => {
    await create();
    setName(CAT.AK_REDLINE, 'ko', 'AK-47 | 레드라인');
    Setting.update({ language: 'zh-CN' });
    expect((await list('?search=redline')).items).toHaveLength(1);
    expect((await list(`?search=${encodeURIComponent('레드라인')}`)).items).toHaveLength(0);
    Setting.update({ language: 'ko' });
    expect((await list(`?search=${encodeURIComponent('레드라인')}`)).items).toHaveLength(1);
  });

  test('a busca combina com categoria, aba e stagnantOnly também em /groups, e saleStateCounts acompanha', async () => {
    const a = await create({ acquiredAt: iso(-40) });
    const b = await create({ acquiredAt: iso(-40) });
    await create({ catalogId: CAT.AWP_DLORE, acquiredAt: iso(-40) });
    await offSale(b.id);
    const g = await groups('?search=ak&category=SKIN&saleState=FOR_SALE&stagnantOnly=true');
    expect(g.groups).toHaveLength(1);
    expect(g.groups[0].units.map((u) => u.id)).toEqual([a.id]);
    expect(g.meta.saleStateCounts).toEqual({ forSale: 1, offSale: 1 });
    const h = await groups('?search=ak&saleState=OFF_SALE');
    expect(h.groups[0].units.map((u) => u.id)).toEqual([b.id]);
    expect(h.meta.count).toBe(1);
    const nothing = await groups('?search=ak&category=FACA');
    expect(nothing.groups).toEqual([]);
    expect(nothing.meta).toMatchObject({ count: 0, groupCount: 0, saleStateCounts: { forSale: 0, offSale: 0 } });
  });

  test('a busca não entra nas vendas (status VENDIDO) com efeito em position, e itens vendidos também são filtrados', async () => {
    const item = await create();
    await create({ catalogId: CAT.AWP_DLORE });
    await request(app).post(`/api/items/${item.id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 800, soldAt: NOW.toISOString() });
    expect((await list('?status=VENDIDO&search=awp')).items).toEqual([]);
    expect((await list('?status=VENDIDO&search=redline')).items).toHaveLength(1);
  });

  test('a busca "só espaço interno" e tabulação: aparada nas pontas, interna preservada', async () => {
    await create();
    expect((await list(`?search=${encodeURIComponent('\tak-47\t')}`)).items).toHaveLength(1);
    expect((await list(`?search=${encodeURIComponent('ak-47 | redline')}`)).items).toHaveLength(1);
  });

  test('position: soma bate com o resumo do lucro real com holding em lock e vários itens; nextUnlockAt é o menor entre os à venda', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: NOW });
    await create({ purchasePriceCents: 1000, tradeUnlockAt: iso(9) });
    await create({ purchasePriceCents: 250, tradeUnlockAt: iso(3) });
    await create({ purchasePriceCents: 125, tradeUnlockAt: iso(-1) }); // já liberado: não conta como lock
    const h = await create({ purchasePriceCents: 75, tradeUnlockAt: iso(1) });
    await offSale(h.id);
    const profit = (await request(app).get('/api/profit/summary')).body.data;
    const { position } = (await list('?search=awp')).meta;
    expect(position.tradeLocked).toEqual({ units: 2, nextUnlockAt: iso(3) });
    expect(position.forSale.costUsdCents).toBe(1375);
    expect(position.offSale.costUsdCents).toBe(75);
    expect(position.forSale.costUsdCents + position.offSale.costUsdCents).toBe(profit.stockUsdCents);
  });

  test('position com compra em outra moeda (cotação gravada): costUsesRecordedFx verdadeiro e soma ainda igual ao stockBreakdown', async () => {
    await create({ purchasePriceCents: 1000, fxRateAtPurchase: 5, purchaseStoreId: storeId('Steam') });
    const profit = (await request(app).get('/api/profit/summary')).body.data;
    const { position } = (await list()).meta;
    expect(position.forSale.costUsdCents).toBe(profit.stockBreakdown.forSale.usdCents);
    expect(position.forSale.costUsesRecordedFx).toBe(true);
    expect(position.forSale.costUsesRecordedFx).toBe(profit.stockBreakdown.forSale.estimated);
  });
});
