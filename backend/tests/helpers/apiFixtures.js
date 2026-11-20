'use strict';

// Helpers dos testes de API (não é arquivo de teste). Relógio fixo: 2026-11-19T15:00:00Z (12:00 em Brasília).
const request = require('supertest');
const { createApp } = require('../../src/app');
const { storeIdByName } = require('./fixtures');
const { CAT, importCatalogFixture } = require('./catalog');

const NOW = new Date('2026-11-19T15:00:00.000Z');

// `catalog: true` importa o catálogo de fixture no banco atual (D86); por padrão o catálogo fica como está.
function makeApp(now = NOW, { fetchFn, catalog = false } = {}) {
  if (catalog) importCatalogFixture();
  return createApp({ now: () => new Date(now.getTime()), fetchFn });
}

// App com o catálogo de fixture já importado (testes de itens).
function makeCatalogApp(now = NOW, options = {}) {
  return makeApp(now, { ...options, catalog: true });
}

function storeId(name) {
  return storeIdByName(name);
}

// Corpo mínimo de COMPRA de uma skin na CSFloat (USD, 100 centavos).
function purchaseBody(overrides = {}) {
  return {
    catalogId: CAT.AK_REDLINE, // nome e categoria vêm do catálogo (D78)
    acquisitionType: 'COMPRA',
    purchaseStoreId: storeId('CSFloat'),
    purchasePriceCents: 100,
    acquiredAt: '2026-11-10T12:00:00.000Z',
    ...overrides,
  };
}

async function createItemViaApi(app, body = purchaseBody()) {
  const res = await request(app).post('/api/items').send(body);
  if (res.status !== 201) throw new Error(`Falha ao criar item: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

function expectError(res, status, code) {
  expect(res.status).toBe(status);
  expect(res.body).toEqual({ success: false, error: { code, message: expect.any(String) } });
  expect(res.body.error.message.length).toBeGreaterThan(0);
}

module.exports = { CAT, NOW, makeApp, makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError };
