// Fixtures compartilhadas pelos testes (não é arquivo de teste).
const { getDb, closeDb } = require('../../src/config/database');

// Garante um banco :memory: novo (schema + seed) a cada teste.
// A moeda de conversão (D369, v024) de um banco novo é USD; a maioria dos testes foi escrita quando o "≈" era sempre "≈ R$", então por
// padrão o banco de teste usa BRL (como os bancos existentes após a migração). Passe `{ displayCurrency: null }` para ficar com o padrão
// de uma instalação nova (USD) ou outra moeda para testá-la.
// A loja Steam de uma instalação nova nasce na moeda de conversão inicial (USD, 11.4); com o padrão BRL do teste ela fica em BRL, como nos
// bancos existentes (a maioria dos testes usa a Steam em BRL). `{ steamCurrency }` força outra moeda para a Steam.
function freshDb({ displayCurrency = 'BRL', steamCurrency } = {}) {
  closeDb();
  const db = getDb();
  if (displayCurrency !== null) db.prepare('UPDATE settings SET display_currency = ?').run(displayCurrency);
  const steam = steamCurrency ?? (displayCurrency === 'BRL' ? 'BRL' : null);
  if (steam !== null) db.prepare("UPDATE stores SET currency = ? WHERE name = 'Steam'").run(steam);
  return db;
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
