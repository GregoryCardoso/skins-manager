'use strict';

// QA 9.1 (D290, D316 seção 6): a chave da API nunca vai para backups (exportação manual, backup automático antes de importar)
// e a importação preserva a chave atual, inclusive no caminho de falha. Banco de arquivo temporário; dados inventados.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-integ-'));
const dbFile = path.join(dir, 'inventory.sqlite');
jest.setTimeout(120000);

let request;
let database;
let app;
let Database;
let backupService;
let integrationService;
let MIGRATIONS;
let KEY;
let OTHER_KEY;
let PII;
const consoleSpies = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(() => {
  jest.resetModules();
  process.env.DB_PATH = dbFile;
  request = require('supertest');
  Database = require('better-sqlite3');
  database = require('../../src/config/database');
  ({ MIGRATIONS } = require('../../src/config/migrations'));
  backupService = require('../../src/services/backupService');
  integrationService = require('../../src/services/integrationService');
  ({ KEY, OTHER_KEY, PII } = require('../helpers/csfloatFixtures'));
  require('../../src/services/catalogService').setDefaultCatalogValidation({ minRows: {}, maxSkippedRatio: 1, requireSkinShape: false });
  app = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024, now: () => new Date('2026-11-22T12:00:00.000Z') });
  database.getDb();
});

afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) consoleSpies.push(jest.spyOn(console, method).mockImplementation(() => {}));
});
afterEach(() => {
  const output = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls));
  while (consoleSpies.length) consoleSpies.pop().mockRestore();
  expect(output).not.toContain(KEY);
  expect(output).not.toContain(OTHER_KEY);
});

const JSON_TYPE = 'application/json';
const octet = (buf) => request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(buf);
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
// A liberação da exportação acontece no 'close' do stream, um instante depois de o cliente receber o último byte: espera.
async function settle() {
  for (let i = 0; i < 200 && backupService.isBackupBusy(); i += 1) await sleep(10);
}
const exportBuffer = async () => {
  const res = await request(app).get('/api/backup/export').buffer(true).parse(binary);
  expect(res.status).toBe(200);
  await settle();
  return res.body;
};
const importFile = async (buf) => {
  await settle();
  return octet(buf);
};
const putKey = (apiKey) => request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey });
const view = async () => (await request(app).get('/api/integrations/csfloat')).body.data;
const currentKey = () => integrationService.getApiKeyForCall();
const hasBytes = (buf, text) => Buffer.from(buf).includes(Buffer.from(text));
const listFiles = (sub) => {
  const folder = path.join(dir, sub);
  return fs.existsSync(folder) ? fs.readdirSync(folder).map((n) => path.join(folder, n)) : [];
};
// Cópia do banco ATUAL com a chave ainda dentro (só para simular um arquivo "estranho" a importar).
function rawCopyWith(name, mutate) {
  const target = path.join(dir, name);
  database.exportDatabaseTo(target, { stripSecrets: false });
  const copy = new Database(target);
  mutate(copy);
  copy.pragma('wal_checkpoint(TRUNCATE)');
  copy.close();
  return fs.readFileSync(target);
}

describe('exportação manual', () => {
  test('o arquivo exportado não contém a chave: nem coluna nula, nem busca binária (VACUUM), mesmo após trocar a chave', async () => {
    await putKey(KEY);
    await putKey(OTHER_KEY); // a chave antiga fica em páginas livres do banco vivo
    const exported = await exportBuffer();
    expect(hasBytes(exported, KEY)).toBe(false);
    expect(hasBytes(exported, OTHER_KEY)).toBe(false);
    expect(hasBytes(exported, 'SENTINEL')).toBe(false);
    const file = path.join(dir, 'exportado.sqlite');
    fs.writeFileSync(file, exported);
    const copy = new Database(file, { readonly: true });
    try {
      expect(copy.prepare('SELECT api_key, api_key_saved_at FROM integrations').get().api_key).toBeNull();
      expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      copy.close();
    }
    expect(currentKey()).toBe(OTHER_KEY); // o banco vivo não foi tocado pela limpeza da cópia
  });

  test('o restante da integração (loja, impressão digital, cortes) continua no backup', async () => {
    await putKey(KEY);
    database.getDb().prepare("UPDATE integrations SET trades_cutoff_at = '2026-01-01T00:00:00.000Z', auto_import_on_open = 1").run();
    const exported = await exportBuffer();
    const file = path.join(dir, 'exportado2.sqlite');
    fs.writeFileSync(file, exported);
    const copy = new Database(file, { readonly: true });
    try {
      const row = copy.prepare('SELECT * FROM integrations').get();
      expect(row).toMatchObject({ api_key: null, trades_cutoff_at: '2026-01-01T00:00:00.000Z', auto_import_on_open: 1 });
      expect(row.store_id).not.toBeNull();
    } finally {
      copy.close();
    }
    database.getDb().prepare('UPDATE integrations SET trades_cutoff_at = NULL, auto_import_on_open = 0').run();
  });

  test('dados pessoais falsos do /me nunca existem em arquivo nenhum da pasta de dados (só a impressão digital)', async () => {
    const fetchFn = async () => {
      const { fakeResponse, meBody } = require('../helpers/csfloatFixtures');
      return fakeResponse(200, meBody());
    };
    const withNet = require('../../src/app').createApp({ now: () => new Date('2026-11-22T12:00:00.000Z'), fetchFn });
    await putKey(KEY);
    const res = await request(withNet).post('/api/integrations/csfloat/test').set('Content-Type', JSON_TYPE).send({});
    expect(res.status).toBe(200);
    database.getDb().pragma('wal_checkpoint(TRUNCATE)');
    const exported = await exportBuffer();
    for (const value of [PII.steamId, PII.username, PII.email, PII.tradeToken]) {
      expect(hasBytes(exported, value)).toBe(false);
      expect(hasBytes(fs.readFileSync(dbFile), value)).toBe(false);
    }
  });

  test('falha no meio da exportação: o temporário é apagado, a trava liberada e nada com a chave sobra', async () => {
    await putKey(KEY);
    const tmpBefore = listFiles('tmp');
    const DatabaseFile = require('../../src/models/DatabaseFile');
    const original = DatabaseFile.exportTo;
    const failing = jest.spyOn(DatabaseFile, 'exportTo').mockImplementation((target, options) => {
      original.call(DatabaseFile, target, options);
      throw new Error('falha simulada depois de gerar a cópia');
    });
    const res = await request(app).get('/api/backup/export');
    failing.mockRestore();
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(listFiles('tmp')).toEqual(tmpBefore);
    expect(backupService.isBackupBusy()).toBe(false);
  });

  test('stripSecretsInFile num arquivo somente leitura lança (a exportação nunca entrega a cópia) e libera o arquivo', async () => {
    await putKey(KEY);
    const target = path.join(dir, 'somente-leitura.sqlite');
    database.exportDatabaseTo(target, { stripSecrets: false });
    fs.chmodSync(target, 0o444);
    let threw = false;
    try {
      database.stripSecretsInFile(target);
    } catch (err) {
      threw = true;
    }
    if (process.platform === 'win32' || threw) {
      expect(threw).toBe(true);
    }
    fs.chmodSync(target, 0o666);
    fs.rmSync(target, { force: true }); // o handle foi fechado (no Windows um handle aberto impediria apagar)
    expect(fs.existsSync(target)).toBe(false);
  });
});

describe('importar backup preserva a chave atual', () => {
  test('o backup automático antes de importar também sai sem a chave', async () => {
    await putKey(KEY);
    const exported = await exportBuffer();
    const res = await importFile(exported);
    expect(res.status).toBe(200);
    const backups = listFiles('backups').filter((f) => /before-import/.test(path.basename(f)));
    expect(backups.length).toBeGreaterThan(0);
    for (const file of backups) {
      expect(hasBytes(fs.readFileSync(file), KEY)).toBe(false);
      const copy = new Database(file, { readonly: true });
      try {
        expect(copy.prepare('SELECT api_key FROM integrations').get().api_key).toBeNull();
      } finally {
        copy.close();
      }
    }
    // nenhum arquivo auxiliar (backups, tmp) guarda a chave
    for (const file of [...listFiles('backups'), ...listFiles('tmp')]) expect(hasBytes(fs.readFileSync(file), KEY)).toBe(false);
  });

  test('importar um backup sem chave (exportação normal) mantém a chave atual e a máscara', async () => {
    await putKey(KEY);
    const exported = await exportBuffer();
    expect((await importFile(exported)).status).toBe(200);
    expect(currentKey()).toBe(KEY);
    expect(await view()).toMatchObject({ hasApiKey: true, apiKeyMasked: '••••••••a1b2' });
  });

  test('importar um arquivo que traz OUTRA chave: fica a chave atual, a do arquivo é sobrescrita', async () => {
    await putKey(KEY);
    const strange = rawCopyWith('com-outra-chave.sqlite', (db) => db.prepare('UPDATE integrations SET api_key = ?').run(OTHER_KEY));
    expect(hasBytes(strange, OTHER_KEY)).toBe(true);
    const res = await importFile(strange);
    expect(res.status).toBe(200);
    expect(currentKey()).toBe(KEY);
    expect(JSON.stringify(res.body)).not.toContain(OTHER_KEY);
    expect((await view()).apiKeyMasked).toBe('••••••••a1b2');
  });

  test('sem chave atual e arquivo com chave: depois de importar não há chave (a do arquivo é descartada)', async () => {
    await request(app).delete('/api/integrations/csfloat/api-key');
    const strange = rawCopyWith('com-chave-sem-atual.sqlite', (db) => db.prepare('UPDATE integrations SET api_key = ?').run(OTHER_KEY));
    expect((await importFile(strange)).status).toBe(200);
    expect(currentKey()).toBeNull();
    expect(await view()).toMatchObject({ hasApiKey: false, apiKeyMasked: null });
  });

  test('o resto da integração vem do arquivo importado (loja, corte, importar ao abrir)', async () => {
    await putKey(KEY);
    const strange = rawCopyWith('resto-do-arquivo.sqlite', (db) => {
      db.prepare("UPDATE integrations SET store_id = NULL, trades_cutoff_at = '2026-02-02T00:00:00.000Z', auto_import_on_open = 1").run();
    });
    expect((await importFile(strange)).status).toBe(200);
    expect(await view()).toMatchObject({
      storeId: expect.any(Number), // religado pelo nome (D317)
      tradesCutoffAt: '2026-02-02T00:00:00.000Z', autoImportOnOpen: true, hasApiKey: true, apiKeyMasked: '••••••••a1b2',
    });
    database.getDb().prepare('UPDATE integrations SET trades_cutoff_at = NULL, auto_import_on_open = 0').run();
    database.getDb().prepare("UPDATE integrations SET store_id = (SELECT id FROM stores WHERE name = 'CSFloat')").run();
  });

  test('backup antigo v11 (sem a tabela) importa: tabela e linha criadas, loja ligada e chave atual mantida', async () => {
    await putKey(KEY);
    const file = path.join(dir, 'v11.sqlite');
    database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= 11) }).close();
    const res = await importFile(fs.readFileSync(file));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: 11, schemaVersion: 17 });
    expect(res.body.data.migrationsApplied).toContain(12);
    expect(currentKey()).toBe(KEY);
    const v = await view();
    expect(v).toMatchObject({ source: 'CSFLOAT', storeName: 'CSFloat', hasApiKey: true, accountLinked: false });
  });

  test('backup v10 e v6 (bem antigos) também importam e mantêm a chave', async () => {
    for (const version of [6, 10]) {
      await putKey(KEY);
      const file = path.join(dir, `v${version}.sqlite`);
      database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= version) }).close();
      const res = await importFile(fs.readFileSync(file));
      expect(res.status).toBe(200);
      expect(res.body.data.schemaVersion).toBe(17);
      expect(currentKey()).toBe(KEY);
    }
  });

  test('falha na reabertura: os dados anteriores voltam E a chave é mantida (restauração com restoreSecrets)', async () => {
    await putKey(KEY);
    const strange = rawCopyWith('para-falhar.sqlite', (db) => {
      db.prepare('UPDATE integrations SET api_key = ?').run(OTHER_KEY);
      db.prepare("UPDATE settings SET language = 'en'").run();
    });
    await request(app).patch('/api/settings').send({ language: 'pt-BR' });
    await settle();
    const spy = jest.spyOn(database, 'getDb').mockImplementationOnce(() => {
      throw new Error('falha simulada');
    });
    const res = await octet(strange);
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('BACKUP_IMPORT_FAILED');
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect((await request(app).get('/api/settings')).body.data.language).toBe('pt-BR'); // dados anteriores
    expect(currentKey()).toBe(KEY); // a chave não se perdeu (o backup automático está sem ela)
    expect(hasBytes(fs.readFileSync(dbFile), OTHER_KEY)).toBe(false);
    expect(listFiles('tmp')).toEqual([]);
  });

  test('falha na reabertura sem chave atual: continua sem chave e a do arquivo não entra', async () => {
    await request(app).delete('/api/integrations/csfloat/api-key');
    const strange = rawCopyWith('para-falhar-sem-chave.sqlite', (db) => db.prepare('UPDATE integrations SET api_key = ?').run(OTHER_KEY));
    await settle();
    const spy = jest.spyOn(database, 'getDb').mockImplementationOnce(() => {
      throw new Error('falha simulada');
    });
    const res = await octet(strange);
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(currentKey()).toBeNull();
  });

  test('arquivo inválido (não é SQLite) recusa sem mexer na chave', async () => {
    await putKey(KEY);
    const res = await importFile(Buffer.from('isto nao e um banco sqlite, so texto'));
    expect(res.status).toBe(400);
    expect(currentKey()).toBe(KEY);
  });

  test('captureSecrets/restoreSecrets: unitário (mapa por fonte, nulo e chave do arquivo sobrescrita)', async () => {
    await putKey(KEY);
    const secrets = integrationService.captureSecrets();
    expect(secrets).toEqual({ CSFLOAT: KEY });
    integrationService.restoreSecrets({ CSFLOAT: null });
    expect(currentKey()).toBeNull();
    integrationService.restoreSecrets(secrets);
    expect(currentKey()).toBe(KEY);
    integrationService.restoreSecrets({});
    expect(currentKey()).toBeNull();
    integrationService.restoreSecrets(null);
    expect(currentKey()).toBeNull();
    integrationService.restoreSecrets({ CSFLOAT: 12345678 }); // valor que não é texto é ignorado
    expect(currentKey()).toBeNull();
  });
});
