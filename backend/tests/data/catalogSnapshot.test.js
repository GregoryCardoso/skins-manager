'use strict';

// Testa o arquivo REAL embutido no projeto (data/seed/catalog.json), gerado por `npm run catalog:snapshot`.
const fs = require('fs');
const { closeDb, getDb } = require('../../src/config/database');
const { CATALOG_SNAPSHOT_PATH } = require('../../src/config/constants');
const svc = require('../../src/services/catalogService');
const { freshDb } = require('../helpers/fixtures');

const MAX_BYTES = 10 * 1024 * 1024;

let text;
let parsed;
beforeAll(() => {
  text = fs.readFileSync(CATALOG_SNAPSHOT_PATH, 'utf8');
  parsed = svc.parseSnapshot(text);
});
afterAll(() => closeDb());

describe('data/seed/catalog.json', () => {
  test('é aceito pelo parseSnapshot e menor que 10 MB', () => {
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(text)).toBeLessThan(MAX_BYTES);
  });

  test('é compacto: uma linha de rows por linha do arquivo, ordenado por id', () => {
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(parsed.rows.length + 2);
    const ids = parsed.rows.map((r) => r.id);
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  test('ids únicos', () => {
    expect(new Set(parsed.rows.map((r) => r.id)).size).toBe(parsed.rows.length);
  });

  test('contagens mínimas por fonte e coerentes com o cabeçalho', () => {
    const header = JSON.parse(text).counts;
    const counts = { SKINS: 0, STICKERS: 0, CRATES: 0, KEYCHAINS: 0, AGENTS: 0, PATCHES: 0 };
    for (const r of parsed.rows) counts[r.source] += 1;
    expect(counts).toEqual(header);
    expect(counts.SKINS).toBeGreaterThan(1000);
    expect(counts.STICKERS).toBeGreaterThan(3000);
    expect(counts.CRATES).toBeGreaterThan(100);
    expect(counts.KEYCHAINS).toBeGreaterThan(10);
    expect(counts.AGENTS).toBeGreaterThan(20);
    expect(counts.PATCHES).toBeGreaterThan(20); // patches.json da CSGO-API (D362)
  });

  test('tem facas com fase e luvas, e AK-47 | Redline com faixa de float', () => {
    expect(parsed.rows.some((r) => r.category === 'FACA' && r.phase)).toBe(true);
    expect(parsed.rows.some((r) => r.category === 'LUVA')).toBe(true);
    const redline = parsed.rows.find((r) => r.name === 'AK-47 | Redline');
    expect(redline).toMatchObject({ category: 'SKIN', minFloat: 0.1, maxFloat: 0.7 });
  });

  test('importa num banco :memory: sem violar CHECK, é idempotente e aceita busca', () => {
    freshDb();
    const first = svc.syncBundledCatalog({ now: new Date('2026-11-20T00:00:00.000Z') });
    expect(first).toMatchObject({ imported: parsed.rows.length, error: null });
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM catalog_items').get().n).toBe(parsed.rows.length);
    expect(svc.getCatalogStatus().catalogUpdatedAt).toBe(parsed.generatedAt);
    expect(svc.syncBundledCatalog({ now: new Date('2026-11-21T00:00:00.000Z') }).imported).toBe(0);
    expect(svc.searchCatalog({ q: 'ak-47 redline' }).items.map((i) => i.name)).toContain('AK-47 | Redline');
  });
});
