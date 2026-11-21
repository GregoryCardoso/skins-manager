'use strict';

// Limites de giro configuráveis (D159) pela API: validação por campo, regra cruzada, GET e efeito nas listas.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const patch = (body) => request(app).patch('/api/settings').send(body);
const settings = async () => (await request(app).get('/api/settings')).body.data;
// now = 2026-11-19T15:00Z; N dias antes, exatamente.
const daysAgo = (n) => new Date(Date.UTC(2026, 10, 19 - n, 15, 0, 0)).toISOString();

describe('GET /api/settings: limites', () => {
  test('padrões: salvos nulos, efetivos 7 e 21 (.env), padrões e sem ajuste', async () => {
    expect(await settings()).toMatchObject({
      fastTurnoverDaysCustom: null,
      slowItemDaysCustom: null,
      fastTurnoverDays: 7,
      slowItemDays: 21,
      fastTurnoverDaysDefault: 7,
      slowItemDaysDefault: 21,
      agingThresholdsAdjusted: false,
    });
  });

  test('salvos, efetivos e padrões ficam separados', async () => {
    expect((await patch({ fastTurnoverDays: 3, slowItemDays: 40 })).status).toBe(200);
    expect(await settings()).toMatchObject({
      fastTurnoverDaysCustom: 3, slowItemDaysCustom: 40, fastTurnoverDays: 3, slowItemDays: 40,
      fastTurnoverDaysDefault: 7, slowItemDaysDefault: 21,
    });
  });

  test('só um salvo: o outro segue o padrão', async () => {
    await patch({ slowItemDays: 30 });
    expect(await settings()).toMatchObject({
      fastTurnoverDaysCustom: null, fastTurnoverDays: 7, slowItemDaysCustom: 30, slowItemDays: 30,
    });
  });

  test('salvaguarda: combinação incoerente sem PATCH (ex.: .env mudou) usa rápido = agarrado − 1 e sinaliza', async () => {
    getDb().prepare('UPDATE settings SET fast_turnover_days = 25 WHERE id = 1').run(); // salvo 25, padrão .env 21
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await settings()).toMatchObject({
        fastTurnoverDaysCustom: 25, fastTurnoverDays: 20, slowItemDays: 21, agingThresholdsAdjusted: true,
      });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('PATCH /api/settings: limites', () => {
  test('grava os dois e responde o Settings completo', async () => {
    const res = await patch({ fastTurnoverDays: 5, slowItemDays: 30 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fastTurnoverDays: 5, slowItemDays: 30 });
  });

  test.each([0, 365, 1.5, '7', -1, true, [], {}])('fastTurnoverDays %j → INVALID_FAST_TURNOVER_DAYS', async (v) => {
    expectError(await patch({ fastTurnoverDays: v }), 400, 'INVALID_FAST_TURNOVER_DAYS', { field: 'fastTurnoverDays' });
  });

  test.each([1, 366, 21.5, '21', 0, true])('slowItemDays %j → INVALID_SLOW_ITEM_DAYS', async (v) => {
    expectError(await patch({ slowItemDays: v }), 400, 'INVALID_SLOW_ITEM_DAYS', { field: 'slowItemDays' });
  });

  test('limites do intervalo: F 1 e 364, S 2 e 365', async () => {
    expect((await patch({ fastTurnoverDays: 1, slowItemDays: 2 })).status).toBe(200);
    expect((await patch({ fastTurnoverDays: 364, slowItemDays: 365 })).status).toBe(200);
  });

  test('F = S e F > S → AGING_THRESHOLDS_ORDER com params (field = fastTurnoverDays quando vêm os dois)', async () => {
    expectError(await patch({ fastTurnoverDays: 10, slowItemDays: 10 }), 400, 'AGING_THRESHOLDS_ORDER', {
      field: 'fastTurnoverDays', params: { fastTurnoverDays: 10, slowItemDays: 10 },
    });
    expectError(await patch({ fastTurnoverDays: 30, slowItemDays: 10 }), 400, 'AGING_THRESHOLDS_ORDER', {
      field: 'fastTurnoverDays', params: { fastTurnoverDays: 30, slowItemDays: 10 },
    });
  });

  test('um campo é validado contra o efetivo do outro (padrão 21 / 7)', async () => {
    expectError(await patch({ fastTurnoverDays: 21 }), 400, 'AGING_THRESHOLDS_ORDER', {
      field: 'fastTurnoverDays', params: { fastTurnoverDays: 21, slowItemDays: 21 },
    });
    expectError(await patch({ slowItemDays: 7 }), 400, 'AGING_THRESHOLDS_ORDER', {
      field: 'slowItemDays', params: { fastTurnoverDays: 7, slowItemDays: 7 },
    });
    expect((await patch({ fastTurnoverDays: 20 })).status).toBe(200);
    expect((await patch({ fastTurnoverDays: null, slowItemDays: 8 })).status).toBe(200);
  });

  test('null que viola a ordem: F salvo 25 e slowItemDays null (padrão 21) é recusado', async () => {
    expect((await patch({ fastTurnoverDays: 25, slowItemDays: 40 })).status).toBe(200);
    expectError(await patch({ slowItemDays: null }), 400, 'AGING_THRESHOLDS_ORDER', {
      field: 'slowItemDays', params: { fastTurnoverDays: 25, slowItemDays: 21 },
    });
    expect(await settings()).toMatchObject({ fastTurnoverDaysCustom: 25, slowItemDaysCustom: 40 });
  });

  test('null restaura o padrão de cada campo', async () => {
    await patch({ fastTurnoverDays: 3, slowItemDays: 40 });
    const res = await patch({ fastTurnoverDays: null, slowItemDays: null });
    expect(res.body.data).toMatchObject({
      fastTurnoverDaysCustom: null, slowItemDaysCustom: null, fastTurnoverDays: 7, slowItemDays: 21,
    });
  });

  test('erro de campo vem antes da regra cruzada; nada é gravado em caso de erro', async () => {
    expectError(await patch({ fastTurnoverDays: 0, slowItemDays: 1 }), 400, 'INVALID_FAST_TURNOVER_DAYS');
    expectError(await patch({ theme: 'DARK', fastTurnoverDays: 50 }), 400, 'AGING_THRESHOLDS_ORDER');
    expect(await settings()).toMatchObject({ theme: 'SYSTEM', fastTurnoverDaysCustom: null });
  });

  test('combina com tema e idioma no mesmo PATCH', async () => {
    const res = await patch({ theme: 'DARK', language: 'en', fastTurnoverDays: 4 });
    expect(res.body.data).toMatchObject({ theme: 'DARK', language: 'en', fastTurnoverDays: 4 });
  });

  test('campo desconhecido continua recusado', async () => {
    expectError(await patch({ fastDays: 3 }), 400, 'UNKNOWN_FIELD', { field: 'fastDays' });
  });
});

describe('efeito nas listas', () => {
  async function seed() {
    const created = [];
    for (const n of [3, 10, 25]) created.push(await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(n) })));
    return created;
  }

  test('meta de /items e /items/sales traz fastTurnoverDays e slowItemDays efetivos', async () => {
    await seed();
    await patch({ fastTurnoverDays: 2, slowItemDays: 12 });
    const items = await request(app).get('/api/items');
    expect(items.body.data.meta).toMatchObject({ fastTurnoverDays: 2, slowItemDays: 12 });
    const sales = await request(app).get('/api/items/sales');
    expect(sales.body.data.meta).toMatchObject({ fastTurnoverDays: 2, slowItemDays: 12 });
  });

  test('mudar os limites reclassifica e filtra pelos efetivos, sem alterar o banco', async () => {
    const [a, b, c] = await seed();
    const buckets = async () =>
      Object.fromEntries((await request(app).get('/api/items')).body.data.items.map((i) => [i.id, i.aging.agingBucket]));
    expect(await buckets()).toEqual({ [a.id]: 'RECENTE', [b.id]: 'EM_GIRO', [c.id]: 'AGARRADO' });
    const before = getDb().prepare('SELECT * FROM items ORDER BY id').all();
    await patch({ fastTurnoverDays: 10, slowItemDays: 30 });
    expect(await buckets()).toEqual({ [a.id]: 'RECENTE', [b.id]: 'RECENTE', [c.id]: 'EM_GIRO' });
    expect((await request(app).get('/api/items?stagnantOnly=true')).body.data.items).toEqual([]);
    await patch({ fastTurnoverDays: 1, slowItemDays: 2 });
    expect((await request(app).get('/api/items?stagnantOnly=true')).body.data.items.map((i) => i.id)).toEqual([a.id, b.id, c.id]);
    expect(getDb().prepare('SELECT * FROM items ORDER BY id').all()).toEqual(before);
  });

  test('vendas usam os limites efetivos', async () => {
    const [a] = await seed(); // adquirido há 3 dias
    const sold = await request(app)
      .post(`/api/items/${a.id}/sell`)
      .send({ saleStoreId: storeId('CSFloat'), salePriceCents: 500, soldAt: daysAgo(0) });
    expect(sold.body.data.item.aging).toMatchObject({ turnaroundDays: 3, turnaroundBucket: 'GIRO_RAPIDO' });
    await patch({ fastTurnoverDays: 2, slowItemDays: 3 });
    const list = await request(app).get('/api/items/sales');
    expect(list.body.data.items[0].aging.turnaroundBucket).toBe('GIRO_NORMAL');
    await patch({ fastTurnoverDays: 1, slowItemDays: 2 });
    expect((await request(app).get('/api/items/sales')).body.data.items[0].aging.turnaroundBucket).toBe('DEMOROU_VENDER');
  });
});
