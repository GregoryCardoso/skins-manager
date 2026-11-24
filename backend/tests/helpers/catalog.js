'use strict';

// Helper dos testes (não é arquivo de teste): importa o catálogo de fixture e exporta ids constantes.
const fs = require('fs');
const path = require('path');
const catalogService = require('../../src/services/catalogService');
const CatalogItem = require('../../src/models/CatalogItem');
const { normalizeSearchText } = require('../../src/services/catalog/csgoApiAdapter');

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'catalog-snapshot.json');

const CAT = Object.freeze({
  AK_REDLINE: 'skin-ak-redline', // SKIN, float 0.10..0.70, StatTrak
  AWP_DLORE: 'skin-awp-dlore', // SKIN, 0..0.70
  M4A1S_PRINTSTREAM: 'skin-m4a1s-printstream', // SKIN, 0..0.80
  GLOCK_NO_RANGE: 'skin-glock-sem-faixa', // SKIN, sem faixa de float
  DEAGLE_DDPAT: 'skin-deagle-ddpat', // SKIN, 0.06..0.80, Souvenir
  KARAMBIT_DOPPLER_P1: 'skin-karambit-doppler-p1', // FACA, fase Phase 1, 0..0.08
  KARAMBIT_DOPPLER_P2: 'skin-karambit-doppler-p2', // FACA, fase Phase 2, 0..0.08
  KARAMBIT_FADE: 'skin-karambit-fade', // FACA, sem fase, 0..0.08
  KARAMBIT_VANILLA: 'skin-karambit-vanilla', // FACA, sem faixa
  BAYONET_BLUE_STEEL_A: 'skin-bayonet-bluesteel-a', // FACA, nome repetido (ambíguo)
  BAYONET_BLUE_STEEL_B: 'skin-bayonet-bluesteel-b',
  SPORT_GLOVES_PANDORA: 'skin-sport-gloves-pandora', // LUVA, 0.06..0.80
  STICKER_TITAN: 'sticker-titan-kato14', // STICKER
  STICKER_CROWN: 'sticker-crown-foil', // STICKER
  CASE_REVOLVER: 'crate-revolver', // CAIXA
  SOUVENIR_DUST2: 'crate-dust2-souvenir', // CAIXA
  CAPSULE_KATO14: 'crate-kato14-legends', // CAPSULA
  MUSIC_KIT_BOX: 'crate-music-kit-box', // OUTRO (crate)
  BATTLE_PASS_RIPTIDE: 'crate-riptide-pass', // PASSE_BATALHA (só no fixture)
  CHARM_LIL_AVA: 'keychain-lil-ava', // PINGENTE
  AGENT_DARRYL: 'agent-4613', // PERSONAGEM
});

function readFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

// Importa o fixture no banco atual (use depois de `freshDb()`).
function importCatalogFixture({ now = new Date('2026-11-01T00:00:00.000Z') } = {}) {
  return catalogService.importSnapshot(readFixture(), { now });
}

// Itens extras do catálogo para a importação de componentes (10.2): as armas e os stickers/chaveiro dos exemplos reais.
const SKINS = [
  ['skin-deagle-trigger', 'Desert Eagle | Trigger Discipline'],
  ['skin-glock-moonrise', 'Glock-18 | Moonrise'],
  ['skin-m4a4-toothfairy', 'M4A4 | Tooth Fairy'],
  ['skin-glock-offworld', 'Glock-18 | Off World'],
  ['skin-m4a1s-mudspec', 'M4A1-S | Mud-Spec'],
];
const STICKERS = [
  ['sticker-big-rmr', 'Sticker | BIG (Holo) | 2020 RMR'],
  ['sticker-heroic-rmr', 'Sticker | Heroic (Foil) | 2020 RMR'],
  ['sticker-nip-rmr', 'Sticker | Ninjas in Pyjamas (Holo) | 2020 RMR'],
  ['sticker-flit-rio', 'Sticker | FL1T (Champion) | Rio 2022'],
  ['sticker-clavis', 'Sticker | Clavis'],
  ['sticker-boom-rmr', 'Sticker | Boom | 2020 RMR'],
  ['sticker-fly-high', 'Sticker | Fly High'],
  ['sticker-scavenger', 'Sticker | Scavenger'],
  ['sticker-flickshot', 'Sticker | Flickshot'],
  ['sticker-battlefield-portal', 'Sticker | Battlefield Portal'],
  ['sticker-separate-pixels', 'Sticker | Separate Pixels'],
  ['sticker-operation-riptide', 'Sticker | Operation Riptide'],
  ['sticker-stone-scales', 'Sticker | Stone Scales'],
  ['sticker-choose-wisely', 'Sticker | Choose Wisely'],
];
const CAT_EXTRA = Object.freeze({
  FLY_HIGH: 'sticker-fly-high', BIG: 'sticker-big-rmr', BOOM: 'sticker-boom-rmr', FLICKSHOT: 'sticker-flickshot', LIL_TEACUP: 'keychain-lil-teacup',
  DEAGLE_TRIGGER: 'skin-deagle-trigger', GLOCK_MOONRISE: 'skin-glock-moonrise', M4A1S_MUDSPEC: 'skin-m4a1s-mudspec', GLOCK_OFFWORLD: 'skin-glock-offworld',
});

function seedComponentCatalog({ now = new Date('2026-11-01T00:00:00.000Z') } = {}) {
  const row = (id, source, category, name, extra = {}) => ({
    id, source, category, name, nameKey: normalizeSearchText(name), searchText: normalizeSearchText(name), minFloat: null, maxFloat: null,
    hasStattrak: false, hasSouvenir: false, ...extra,
  });
  CatalogItem.upsertMany([
    ...SKINS.map(([id, name]) => row(id, 'SKINS', 'SKIN', name, { minFloat: 0, maxFloat: 1, hasStattrak: true })),
    ...STICKERS.map(([id, name]) => row(id, 'STICKERS', 'STICKER', name)),
    row('keychain-lil-teacup', 'KEYCHAINS', 'PINGENTE', "Charm | Lil' Teacup"),
  ], { now });
}

module.exports = { CAT, CAT_EXTRA, FIXTURE_PATH, readFixture, importCatalogFixture, seedComponentCatalog };
