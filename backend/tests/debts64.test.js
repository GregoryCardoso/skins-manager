'use strict';

// Débitos da 6.4 (D153): T27, T36, T44 e os ajustes de backup apontados na 6.3.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { closeDb, openDatabase } = require('../src/config/database');
const { MIGRATIONS } = require('../src/config/migrations');
const { CATALOG_BASE_URL, CATALOG_MAX_FILE_BYTES } = require('../src/config/constants');
const Item = require('../src/models/Item');
const itemService = require('../src/services/itemService');
const { buildStatsKey } = require('../src/services/itemStatsService');
const { freshDb, wonSkin } = require('./helpers/fixtures');
const { makeCatalogApp, expectError, NOW } = require('./helpers/apiFixtures');

// O teste do teto de 50 MB do catálogo monta e mede um texto de 50 MB: com a máquina carregada passa dos 5 s padrão (etapa 11.10).
jest.setTimeout(30000);

afterAll(() => closeDb());

describe('backupRetention: módulo puro, sem ciclo com config/database', () => {
  test('não carrega database, services nem models', () => {
    jest.isolateModules(() => {
      const retention = require('../src/config/backupRetention');
      expect(retention.AUTO_BACKUP_KEEP).toBe(10);
      expect(typeof retention.selectBackupsToDelete).toBe('function');
      const loaded = Object.keys(require.cache).map((file) => path.relative(path.join(__dirname, '..', 'src'), file));
      expect(loaded.filter((f) => !f.startsWith('..') && f !== path.join('config', 'backupRetention.js'))).toEqual([]);
    });
  });

  test('constants e backupService reexportam os mesmos valores', () => {
    const retention = require('../src/config/backupRetention');
    expect(require('../src/config/constants').AUTO_BACKUP_KEEP).toBe(retention.AUTO_BACKUP_KEEP);
    expect(require('../src/services/backupService').selectBackupsToDelete).toBe(retention.selectBackupsToDelete);
  });
});

describe('backupBeforeMigrating: colisão de nome', () => {
  let tmpRoot;
  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-d64-'));
  });
  afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  test('arquivo com o mesmo carimbo já existe: avança 1 ms e preserva o existente', () => {
    const dbPath = path.join(tmpRoot, 'a', 'inventory.sqlite');
    openDatabase(dbPath, { migrations: MIGRATIONS.filter((m) => m.version <= 4) }).close();
    const backups = path.join(tmpRoot, 'a', 'backups');
    fs.mkdirSync(backups, { recursive: true });
    const taken = path.join(backups, 'inventory-v4-2026-11-20T12-00-00.000Z.sqlite');
    fs.writeFileSync(taken, 'conteudo anterior');
    openDatabase(dbPath, { now: new Date('2026-11-20T12:00:00.000Z') }).close();
    expect(fs.readFileSync(taken, 'utf8')).toBe('conteudo anterior');
    expect(fs.existsSync(path.join(backups, 'inventory-v4-2026-11-20T12-00-00.001Z.sqlite'))).toBe(true);
  });
});

describe('T27: Item.findStatsCandidates', () => {
  beforeEach(() => freshDb());

  test('devolve só candidatos da categoria e do nome; a chave completa decide o grupo', () => {
    const a = Item.create(wonSkin({ name: 'AK-47 | Redline', exterior: 'FT' }));
    const b = Item.create(wonSkin({ name: '  ak-47 |  REDLINE ', exterior: 'FT' }));
    const other = Item.create(wonSkin({ name: 'AWP | Asiimov', exterior: 'FT' }));
    const box = Item.create(wonSkin({ name: 'AK-47 | Redline', category: 'CAIXA', variant: undefined, exterior: undefined }));
    const key = buildStatsKey(a);
    const found = Item.findStatsCandidates(a);
    expect(found.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(found.map((i) => i.id)).not.toContain(other.id);
    expect(found.map((i) => i.id)).not.toContain(box.id);
    expect(found.filter((i) => buildStatsKey(i) === key)).toHaveLength(2);
  });

  test('curinga de LIKE no nome é tratado como texto', () => {
    const a = Item.create(wonSkin({ name: '100%_Item', exterior: 'FT' }));
    Item.create(wonSkin({ name: '100xyItem', exterior: 'FT' }));
    expect(Item.findStatsCandidates(a).map((i) => i.id)).toEqual([a.id]);
  });

  test('nome com "|" e nome só com termos não ASCII ainda são encontrados', () => {
    const a = Item.create(wonSkin({ name: 'Ação | Ωmega', exterior: 'FT' }));
    expect(Item.findStatsCandidates(a).map((i) => i.id)).toContain(a.id);
  });

  test('getItemStats e getItem dão o mesmo resultado sem carregar todos os itens (findAll)', () => {
    const a = Item.create(wonSkin({ name: 'AK-47 | Redline', exterior: 'FT' }));
    Item.create(wonSkin({ name: 'AK-47 | Redline', exterior: 'FT' }));
    Item.create(wonSkin({ name: 'AWP | Asiimov', exterior: 'FT' }));
    const spy = jest.spyOn(Item, 'findAll');
    const stats = itemService.getItemStats({ name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', exterior: 'FT' });
    const view = itemService.getItem(a.id, { now: NOW });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(stats.unitCount).toBe(2);
    expect(view.stats.unitCount).toBe(2);
    expect(view.stats).toEqual(expect.objectContaining({ unitCount: stats.unitCount, soldCount: stats.soldCount }));
  });
});

describe('T36: teto de bytes no download do catálogo', () => {
  beforeEach(() => freshDb());

  const refresh = (app) => request(app).post('/api/catalog/refresh').set('Content-Type', 'application/json').send({});

  test('content-length acima do teto -> 502 CATALOG_INVALID_FORMAT sem ler o corpo', async () => {
    const text = jest.fn(async () => '[]');
    const fetchFn = async () => ({ ok: true, status: 200, headers: { get: () => String(CATALOG_MAX_FILE_BYTES + 1) }, text });
    expectError(await refresh(makeCatalogApp(NOW, { fetchFn })), 502, 'CATALOG_INVALID_FORMAT');
    expect(text).not.toHaveBeenCalled();
  });

  test('stream que passa do teto é cancelado -> 502 CATALOG_INVALID_FORMAT', async () => {
    const cancel = jest.fn(async () => {});
    const reader = {
      read: jest.fn(async () => ({ done: false, value: { byteLength: CATALOG_MAX_FILE_BYTES + 1 } })),
      cancel,
    };
    const fetchFn = async () => ({ ok: true, status: 200, body: { getReader: () => reader } });
    expectError(await refresh(makeCatalogApp(NOW, { fetchFn })), 502, 'CATALOG_INVALID_FORMAT');
    expect(cancel).toHaveBeenCalled();
  });

  test('texto maior que o teto (sem stream) é recusado; a URL base segue a das constantes', async () => {
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, text: async () => ' '.repeat(CATALOG_MAX_FILE_BYTES + 1) };
    };
    expectError(await refresh(makeCatalogApp(NOW, { fetchFn })), 502, 'CATALOG_INVALID_FORMAT');
    expect(urls[0].startsWith(CATALOG_BASE_URL)).toBe(true);
  });
});

describe('T44: POST /api/catalog/refresh exige Content-Type JSON', () => {
  beforeEach(() => freshDb());

  test('sem Content-Type ou com text/plain -> 415 e nenhuma chamada de rede', async () => {
    const fetchFn = jest.fn();
    const app = makeCatalogApp(NOW, { fetchFn });
    expectError(await request(app).post('/api/catalog/refresh'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).post('/api/catalog/refresh').set('Content-Type', 'text/plain').send('{}'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('T28: precedência das validações do POST /api/items', () => {
  const codeOf = (fn) => {
    try {
      fn();
    } catch (err) {
      return err.code;
    }
    return undefined;
  };
  const { resolveItemIdentity, buildItemRecord } = itemService;

  test('identidade vem antes de loja e preço: catalogId inexistente + name -> CATALOG_DERIVED_FIELD', () => {
    expect(codeOf(() => resolveItemIdentity({ body: { catalogId: 'x', name: 'Y', purchasePriceCents: -1 }, catalogEntry: null }))).toBe(
      'CATALOG_DERIVED_FIELD'
    );
    expect(codeOf(() => resolveItemIdentity({ body: { catalogId: 'x' }, catalogEntry: null }))).toBe('CATALOG_ITEM_NOT_FOUND');
    expect(codeOf(() => resolveItemIdentity({ body: { category: 'SKIN' }, catalogEntry: null }))).toBe('CATALOG_ITEM_REQUIRED');
  });

  test('em buildItemRecord: loja da compra antes do preço, preço antes da cotação', () => {
    const base = { name: 'X', category: 'OUTRO', acquisitionType: 'COMPRA', acquiredAt: '2026-11-01T00:00:00Z' };
    const ctx = { settings: { usdBrlRate: null }, now: NOW, body: {} };
    expect(codeOf(() => buildItemRecord({ ...base, purchasePriceCents: -5 }, ctx))).toBe('PURCHASE_STORE_REQUIRED');
    expect(codeOf(() => buildItemRecord({ ...base, purchaseStoreId: 1 }, { ...ctx, store: { currency: 'BRL' } }))).toBe(
      'PURCHASE_PRICE_REQUIRED'
    );
    expect(codeOf(() => buildItemRecord({ ...base, purchaseStoreId: 1, purchasePriceCents: -5 }, { ...ctx, store: { currency: 'BRL' } }))).toBe(
      'INVALID_AMOUNT'
    );
    expect(codeOf(() => buildItemRecord({ ...base, purchaseStoreId: 1, purchasePriceCents: 5 }, { ...ctx, store: { currency: 'BRL' } }))).toBe(
      'FX_RATE_REQUIRED'
    );
  });
});
