// Fixtures compartilhadas pelos testes (não é arquivo de teste).
const { getDb, closeDb } = require('../../src/config/database');

// Garante um banco :memory: novo (schema + seed) a cada teste.
function freshDb() {
  closeDb();
  return getDb();
}

function storeIdByName(name) {
  const row = getDb().prepare('SELECT id FROM stores WHERE name = ?').get(name);
  if (!row) throw new Error(`Loja ${name} não encontrada`);
  return row.id;
}

function wonSkin(overrides = {}) {
  return {
    name: 'AK-47 | Redline',
    category: 'SKIN',
    variant: 'NORMAL',
    acquisitionType: 'GANHEI',
    acquiredAt: '2026-01-10T12:00:00.000Z',
    ...overrides,
  };
}

function soldFields(saleStoreId, overrides = {}) {
  return {
    status: 'VENDIDO',
    saleStoreId,
    salePriceCents: 1000,
    saleCurrency: 'USD',
    saleFeeTypeApplied: 'DEDUCTED',
    saleFeeRateApplied: 0.02,
    saleFeeRoundingApplied: 'CEIL',
    saleFixedFeeCentsApplied: 0,
    netReceivedCents: 980,
    soldAt: '2026-01-20T12:00:00.000Z',
    ...overrides,
  };
}

module.exports = { freshDb, storeIdByName, wonSkin, soldFields };
