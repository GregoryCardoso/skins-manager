'use strict';

// Simulador do CSFloat para o banco de demonstração (9.4): as etapas, em ordem, produzem os casos que o usuário quer ver na tela.
// Roda no banco de teste (em memória); o script real só aceita backend/data/inventory.dev.sqlite.
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture } = require('../helpers/catalog');
const { runStage, STAGES } = require('../../scripts/simulateCsfloat');
const importService = require('../../src/services/imports/importService');

const NOW = new Date('2026-11-22T15:00:00.000Z');

beforeEach(() => {
  freshDb();
  importCatalogFixture();
});
afterAll(() => closeDb());

test('as etapas, na ordem, geram compra revertida, venda revertida, revertido antes de importar e estado desconhecido', async () => {
  expect(STAGES).toEqual(['compra', 'reverter-compra', 'venda', 'reverter-venda', 'antes-de-importar', 'desconhecido']);
  expect((await runStage('compra', { now: NOW })).counts).toMatchObject({ purchasesCreated: 2 });
  const reverted = await runStage('reverter-compra', { now: NOW });
  expect(reverted.entries).toEqual([expect.objectContaining({ outcome: 'REVERTED', reasonCode: 'REVERTED_STATE_FAILED', entityType: 'ITEM_PURCHASE' })]);
  expect((await runStage('venda', { now: NOW })).counts).toMatchObject({ salesCreated: 1 });
  const saleReverted = await runStage('reverter-venda', { now: NOW });
  expect(saleReverted.entries).toEqual([expect.objectContaining({ outcome: 'REVERTED', reasonCode: 'REVERTED_REFUND', entityType: 'ITEM_SALE' })]);
  expect((await runStage('antes-de-importar', { now: NOW })).counts).toMatchObject({ revertedBeforeImport: 1, purchasesCreated: 0 });
  expect((await runStage('desconhecido', { now: NOW })).counts).toMatchObject({ unknownState: 1, purchasesCreated: 0 });

  // "Remover lançamento" nas duas reversões funciona pelo service
  const open = importService.listOpenEntries().entries.filter((e) => e.outcome === 'REVERTED');
  expect(open).toHaveLength(2);
  for (const entry of open) expect(importService.resolveEntry(entry.id, { action: 'REMOVE' }, { now: NOW }).resolution).toBe('REMOVED');
});

test('etapa inválida é recusada', async () => {
  await expect(runStage('xyz', { now: NOW })).rejects.toThrow(/Informe a etapa/);
});
