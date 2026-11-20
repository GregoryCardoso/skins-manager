'use strict';

// Helpers dos testes de API (não é arquivo de teste). Relógio fixo: 2026-11-19T15:00:00Z (12:00 em Brasília).
const request = require('supertest');
const { createApp } = require('../../src/app');
const { storeIdByName } = require('./fixtures');

const NOW = new Date('2026-11-19T15:00:00.000Z');

function makeApp(now = NOW) {
  return createApp({ now: () => new Date(now.getTime()) });
}

function storeId(name) {
  return storeIdByName(name);
}

// Corpo mínimo de COMPRA de uma skin na CSFloat (USD, 100 centavos).
function purchaseBody(overrides = {}) {
  return {
    name: 'AK-47 | Redline',
    category: 'SKIN',
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

module.exports = { NOW, makeApp, storeId, purchaseBody, createItemViaApi, expectError };
