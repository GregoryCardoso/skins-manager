'use strict';

// QA 9.1 (D316, seção 7): API /api/integrations/csfloat com fetchFn falso, banco em memória e dados INVENTADOS.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, storeId, expectError } = require('../helpers/apiFixtures');
const integrationService = require('../../src/services/integrationService');
const {
  KEY, OTHER_KEY, PII, meBody, fakeResponse, fakeFetch, okMe,
} = require('../helpers/csfloatFixtures');

const BASE = '/api/integrations/csfloat';
const JSON_TYPE = 'application/json';
const NOW = new Date('2026-11-22T15:00:00.000Z');

let app;
let fetchFn;
let responses; // todo corpo de resposta da API, para a busca da sentinela
const consoleSpies = [];

function useApp(...steps) {
  fetchFn = fakeFetch(...(steps.length ? steps : [okMe()]));
  app = makeApp(NOW, { fetchFn });
}

beforeEach(() => {
  freshDb();
  responses = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) consoleSpies.push(jest.spyOn(console, method).mockImplementation(() => {}));
  useApp();
});
afterEach(() => {
  while (consoleSpies.length) consoleSpies.pop().mockRestore();
});
afterAll(() => closeDb());

// Executa e guarda o corpo para a varredura final.
const call = async (req) => {
  const res = await req;
  responses.push(JSON.stringify(res.body));
  return res;
};
const get = () => call(request(app).get(BASE));
const patch = (body) => call(request(app).patch(BASE).set('Content-Type', JSON_TYPE).send(body));
const putKey = (apiKey) => call(request(app).put(`${BASE}/api-key`).set('Content-Type', JSON_TYPE).send({ apiKey }));
const delKey = () => call(request(app).delete(`${BASE}/api-key`));
const test_ = (body = {}) => call(request(app).post(`${BASE}/test`).set('Content-Type', JSON_TYPE).send(body));
const switchAcc = (body = { confirm: true }) => call(request(app).post(`${BASE}/switch-account`).set('Content-Type', JSON_TYPE).send(body));

const consoleOutput = () => JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls.map((args) => args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : a)))));
const integrationRow = () => getDb().prepare('SELECT * FROM integrations WHERE source = ?').get('CSFLOAT');
const fullDump = () => {
  const tables = getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  const dump = {};
  for (const name of tables) {
    dump[name] = getDb().prepare(`SELECT * FROM "${name}"`).all().map((row) => {
      const copy = { ...row };
      if (name === 'integrations') delete copy.api_key; // a chave guardada localmente é esperada; o resto não pode ter dado pessoal
      return copy;
    });
  }
  return JSON.stringify(dump);
};

afterEach(() => {
  // varredura global: nenhuma resposta, log ou coluna do banco traz a chave nem dados pessoais falsos
  const all = responses.join('\n');
  for (const secret of [KEY, OTHER_KEY]) {
    expect(all).not.toContain(secret);
    expect(consoleOutput()).not.toContain(secret);
  }
  for (const value of Object.values(PII)) {
    expect(consoleOutput()).not.toContain(value);
    expect(fullDump()).not.toContain(value);
  }
  for (const value of [PII.steamId, PII.steamId2, PII.email, PII.phone, PII.tradeToken, PII.payment, PII.stripe, PII.avatar]) {
    expect(all).not.toContain(value);
  }
});

describe('GET inicial', () => {
  test('linha do seed ligada à loja CSFloat (US$), sem chave e sem conta ligada', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      source: 'CSFLOAT',
      storeId: storeId('CSFloat'),
      storeName: 'CSFloat',
      storeCurrency: 'USD',
      storeSaleFeeRate: expect.any(Number),
      storeWithdrawalFeeRate: expect.anything(),
      hasApiKey: false,
      apiKeyMasked: null,
      apiKeySavedAt: null,
      accountLinked: false,
      autoImportOnOpen: false,
      autoImportPaused: false,
      tradesCutoffAt: null,
      transactionsCutoffAt: null,
      lastImportAt: null,
      lastImportStatus: null,
      lastImportErrorCode: null,
      importInProgress: false,
      openEntriesCount: 0,
      suggestedCutoffAt: null,
      helpUrl: 'https://csfloat.com/profile',
    });
  });
  test('a visão pública nunca expõe o sal nem a impressão digital', async () => {
    await putKey(KEY);
    await test_();
    const body = (await get()).body.data;
    for (const field of ['apiKey', 'accountSalt', 'accountFingerprint', 'account_salt', 'account_fingerprint', 'api_key']) {
      expect(body).not.toHaveProperty(field);
    }
    expect(responses.join('')).not.toMatch(/[0-9a-f]{64}/);
  });
  test('rota desconhecida de integração -> 404 no formato padrão', async () => {
    expectError(await request(app).get('/api/integrations/outra'), 404, 'NOT_FOUND');
  });
});

describe('PUT api-key (máscara e formato)', () => {
  test('salva, devolve a máscara ••••••••a1b2 e nunca a chave', async () => {
    const res = await putKey(KEY);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ hasApiKey: true, apiKeyMasked: '••••••••a1b2', apiKeySavedAt: NOW.toISOString() });
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(JSON.stringify(res.body)).not.toContain('SENTINEL');
    expect(integrationRow().api_key).toBe(KEY);
  });
  test('GET depois de salvar também só devolve a máscara', async () => {
    await putKey(KEY);
    const res = await get();
    expect(res.body.data.apiKeyMasked).toBe('••••••••a1b2');
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });
  test('espaços nas pontas são removidos antes de gravar', async () => {
    await putKey(`  ${KEY}\n`);
    expect(integrationRow().api_key).toBe(KEY);
  });
  test('trocar a chave substitui a anterior e não mexe na impressão digital', async () => {
    await putKey(KEY);
    await test_();
    const before = integrationRow();
    await putKey(OTHER_KEY);
    const after = integrationRow();
    expect(after.api_key).toBe(OTHER_KEY);
    expect(after.account_fingerprint).toBe(before.account_fingerprint);
    expect(after.account_salt).toBe(before.account_salt);
  });
  test.each([
    ['curta (7)', 'abcdefg'],
    ['longa (513)', 'a'.repeat(513)],
    ['com espaço interno', 'abcd efghij'],
    ['só espaços', '        '],
    ['vazia', ''],
    ['número', 123456789],
    ['objeto', { x: 1 }],
  ])('chave %s -> 400 INVALID_API_KEY_FORMAT (field apiKey), sem repetir o valor', async (_n, apiKey) => {
    const res = await putKey(apiKey);
    expectError(res, 400, 'INVALID_API_KEY_FORMAT', { field: 'apiKey' });
    expect(res.body.error.message).not.toContain('abcd efghij');
    expect(integrationRow().api_key).toBeNull();
  });
  test('sem apiKey ou nula -> 400 REQUIRED_FIELD', async () => {
    expectError(await call(request(app).put(`${BASE}/api-key`).set('Content-Type', JSON_TYPE).send({})), 400, 'REQUIRED_FIELD', { field: 'apiKey' });
    expectError(await putKey(null), 400, 'REQUIRED_FIELD', { field: 'apiKey' });
  });
  test('campo extra -> UNKNOWN_FIELD; corpo que não é objeto -> INVALID_BODY', async () => {
    const extra = await call(request(app).put(`${BASE}/api-key`).set('Content-Type', JSON_TYPE).send({ apiKey: KEY, other: 1 }));
    expectError(extra, 400, 'UNKNOWN_FIELD');
    expect(integrationRow().api_key).toBeNull();
    const arr = await call(request(app).put(`${BASE}/api-key`).set('Content-Type', JSON_TYPE).send([KEY]));
    expectError(arr, 400, 'INVALID_BODY');
    expect(JSON.stringify(arr.body)).not.toContain(KEY);
  });
  test('JSON quebrado com a chave no corpo não vaza a chave na resposta nem no console', async () => {
    const res = await call(request(app).put(`${BASE}/api-key`).set('Content-Type', JSON_TYPE).send(`{"apiKey": "${KEY}"`));
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('DELETE api-key', () => {
  test('remove, é idempotente e mantém a impressão digital', async () => {
    await putKey(KEY);
    await test_();
    const fingerprint = integrationRow().account_fingerprint;
    const first = await delKey();
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ hasApiKey: false, apiKeyMasked: null, apiKeySavedAt: null, accountLinked: true });
    const second = await delKey();
    expect(second.status).toBe(200);
    expect(second.body.data.hasApiKey).toBe(false);
    expect(integrationRow().api_key).toBeNull();
    expect(integrationRow().account_fingerprint).toBe(fingerprint);
  });
  test('remover sem nunca ter salvo também dá 200', async () => {
    expect((await delKey()).status).toBe(200);
  });
});

describe('PATCH loja', () => {
  test('loja válida em US$ (CSMoney) é gravada', async () => {
    const res = await patch({ storeId: storeId('CSMoney') });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ storeId: storeId('CSMoney'), storeName: 'CSMoney', storeCurrency: 'USD' });
    expect(integrationRow().store_id).toBe(storeId('CSMoney'));
  });
  test('null desliga a loja', async () => {
    const res = await patch({ storeId: null });
    expect(res.body.data).toMatchObject({ storeId: null, storeName: null, storeCurrency: null, storeSaleFeeRate: null, storeWithdrawalFeeRate: null });
  });
  test('loja inexistente -> 400 STORE_NOT_FOUND (field storeId)', async () => {
    expectError(await patch({ storeId: 9999 }), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
  });
  test('loja em BRL (Steam) -> 400 IMPORT_STORE_CURRENCY_NOT_ALLOWED e a loja anterior continua', async () => {
    expectError(await patch({ storeId: storeId('Steam') }), 400, 'IMPORT_STORE_CURRENCY_NOT_ALLOWED', { field: 'storeId' });
    expect(integrationRow().store_id).toBe(storeId('CSFloat'));
  });
  test.each([[0], [-1], [1.5], ['1'], [true]])('storeId %j -> 400 INVALID_FIELD', async (value) => {
    expectError(await patch({ storeId: value }), 400, 'INVALID_FIELD', { field: 'storeId' });
  });
  test('sem storeId -> INVALID_BODY', async () => {
    expectError(await patch({}), 400, 'INVALID_BODY');
  });
  test('autoImportOnOpen (e outros campos) -> UNKNOWN_FIELD até a 9.5', async () => {
    expectError(await patch({ autoImportOnOpen: true }), 400, 'UNKNOWN_FIELD');
    expectError(await patch({ storeId: storeId('CSFloat'), autoImportOnOpen: true }), 400, 'UNKNOWN_FIELD');
    expectError(await patch({ apiKey: KEY }), 400, 'UNKNOWN_FIELD');
    expect(integrationRow().auto_import_on_open).toBe(0);
    expect(integrationRow().api_key).toBeNull();
  });
  test('corpo que não é objeto -> INVALID_BODY', async () => {
    expectError(await patch([1]), 400, 'INVALID_BODY');
  });
});

describe('lojas e a integração', () => {
  test('excluir a loja ligada deixa store_id nulo, sem 409', async () => {
    const created = await request(app).post('/api/stores').send({ name: 'Loja Teste QA', currency: 'USD' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    await patch({ storeId: id });
    expect((await get()).body.data.storeName).toBe('Loja Teste QA');
    const del = await request(app).delete(`/api/stores/${id}`);
    expect(del.status).toBe(200);
    expect(integrationRow().store_id).toBeNull();
    // sem outra loja "CSFloat" em US$: continua sem vínculo
    await request(app).patch(`/api/stores/${storeId('CSFloat')}`).send({ name: 'Renomeada p/ teste' });
    expect((await get()).body.data).toMatchObject({ storeId: null, storeName: null });
    await request(app).patch(`/api/stores/${storeId('Renomeada p/ teste')}`).send({ name: 'CSFloat' });
  });
  test('religação automática (D317): recriar a loja CSFloat em US$ liga de novo ao ler', async () => {
    const oldId = storeId('CSFloat');
    await request(app).patch(`/api/stores/${oldId}`).send({ name: 'Antiga' });
    await patch({ storeId: null });
    const created = await request(app).post('/api/stores').send({ name: 'csfloat', currency: 'USD' });
    expect(created.status).toBe(201);
    const res = await get();
    expect(res.body.data).toMatchObject({ storeId: created.body.data.id, storeName: 'csfloat', storeCurrency: 'USD' });
    expect(integrationRow().store_id).toBe(created.body.data.id);
  });
  test('loja CSFloat em BRL não é religada', async () => {
    await request(app).patch(`/api/stores/${storeId('CSFloat')}`).send({ name: 'Antiga2' });
    await patch({ storeId: null });
    const created = await request(app).post('/api/stores').send({ name: 'CSFloat', currency: 'BRL' });
    expect(created.status).toBe(201);
    expect((await get()).body.data).toMatchObject({ storeId: null, storeName: null });
  });
  test('renomear a loja ligada aparece na visão (o vínculo é pelo id)', async () => {
    const id = storeId('CSFloat');
    expect((await request(app).patch(`/api/stores/${id}`).send({ name: 'CSFloat Renomeada' })).status).toBe(200);
    expect((await get()).body.data).toMatchObject({ storeId: id, storeName: 'CSFloat Renomeada' });
  });
});

describe('POST test (testar conexão)', () => {
  test('sem chave -> 409 CSFLOAT_API_KEY_REQUIRED e nenhuma chamada de rede', async () => {
    expectError(await test_(), 409, 'CSFLOAT_API_KEY_REQUIRED');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  test('sucesso: username, checkedAt do relógio injetado, ligação da conta na primeira vez', async () => {
    await putKey(KEY);
    const res = await test_();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      ok: true, checkedAt: NOW.toISOString(), username: PII.username, accountMatches: true, accountLinkedNow: true,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.calls[0].url).toBe('https://csfloat.com/api/v1/me');
    expect(fetchFn.calls[0].init.headers.Authorization).toBe(KEY);
  });
  test('o resultado só tem os campos documentados, sem dado sensível', async () => {
    await putKey(KEY);
    const res = await test_();
    expect(Object.keys(res.body.data).sort()).toEqual(['accountLinkedNow', 'accountMatches', 'checkedAt', 'feeCheck', 'ok', 'username']);
    expect(Object.keys(res.body.data.feeCheck).sort()).toEqual([
      'accountSaleFeeRate', 'accountWithdrawalFeeRate', 'saleFeeMatches', 'storeSaleFeeRate', 'storeWithdrawalFeeRate', 'withdrawalFeeMatches',
    ]);
  });
  test('grava só a impressão digital (HMAC) e o sal; nenhuma coluna guarda username, steam_id, e-mail etc.', async () => {
    await putKey(KEY);
    await test_();
    const row = integrationRow();
    expect(row.account_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(row.account_salt).toMatch(/^[0-9a-f]{64}$/);
    expect(row.account_fingerprint).toBe(integrationService.computeFingerprint(PII.steamId, row.account_salt));
    expect(fullDump()).not.toContain(PII.steamId);
    expect(fullDump()).not.toContain(PII.username);
    expect(fullDump()).not.toContain(PII.email);
  });
  test('"Conectado como": o nome vem só na resposta e não é gravado (nem no GET seguinte)', async () => {
    await putKey(KEY);
    await test_();
    expect(JSON.stringify((await get()).body)).not.toContain(PII.username);
  });
  test('a segunda vez confirma a mesma conta (accountMatches true, accountLinkedNow false) sem regravar', async () => {
    await putKey(KEY);
    await test_();
    const before = integrationRow();
    const res = await test_();
    expect(res.body.data).toMatchObject({ accountMatches: true, accountLinkedNow: false });
    expect(integrationRow().account_fingerprint).toBe(before.account_fingerprint);
    expect(integrationRow().account_salt).toBe(before.account_salt);
  });
  test('conta diferente -> accountMatches false e nada é gravado', async () => {
    await putKey(KEY);
    await test_();
    const before = integrationRow();
    useApp(okMe({ user: { steam_id: PII.steamId2, username: PII.username2 } }));
    const res = await test_();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ accountMatches: false, accountLinkedNow: false, username: PII.username2 });
    const after = integrationRow();
    expect({ ...after, updated_at: null }).toEqual({ ...before, updated_at: null });
  });
  test('taxas iguais: feeCheck sem aviso; diferentes: aviso com os dois valores (D314)', async () => {
    await putKey(KEY);
    const store = (await get()).body.data;
    useApp(okMe({ user: { fee: String(store.storeSaleFeeRate), withdraw_fee: String(store.storeWithdrawalFeeRate) } }));
    const same = await test_();
    expect(same.body.data.feeCheck).toMatchObject({ saleFeeMatches: true, withdrawalFeeMatches: true });
    useApp(okMe({ user: { fee: '0.015', withdraw_fee: '0.05' } }));
    const diff = await test_();
    expect(diff.body.data.feeCheck).toMatchObject({
      accountSaleFeeRate: 0.015, storeSaleFeeRate: store.storeSaleFeeRate, saleFeeMatches: false,
      accountWithdrawalFeeRate: 0.05, withdrawalFeeMatches: false,
    });
  });
  test('sem loja escolhida: feeCheck com matches null', async () => {
    await putKey(KEY);
    await request(app).patch(`/api/stores/${storeId('CSFloat')}`).send({ name: 'Outra' });
    await patch({ storeId: null });
    const res = await test_();
    expect(res.body.data.feeCheck).toMatchObject({ storeSaleFeeRate: null, saleFeeMatches: null, withdrawalFeeMatches: null });
  });
  test('corpo não vazio no teste -> UNKNOWN_FIELD', async () => {
    await putKey(KEY);
    expectError(await test_({ x: 1 }), 400, 'UNKNOWN_FIELD');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  describe.each([
    ['401', fakeResponse(401, {}), 'CSFLOAT_AUTH_FAILED'],
    ['403', fakeResponse(403, {}), 'CSFLOAT_AUTH_FAILED'],
    ['código 27', fakeResponse(200, { code: 27 }), 'CSFLOAT_AUTH_FAILED'],
    ['429 com Reset longo', fakeResponse(429, {}, { 'X-RateLimit-Reset': 3600 }), 'IMPORT_RATE_LIMITED'],
    ['5xx', fakeResponse(503, 'indisponível'), 'IMPORT_SOURCE_UNAVAILABLE'],
    ['rede', () => { throw new Error(`ENOTFOUND ${KEY}`); }, 'IMPORT_SOURCE_UNREACHABLE'],
    ['JSON quebrado', fakeResponse(200, '{"user":'), 'IMPORT_SOURCE_FORMAT_CHANGED'],
    ['sem steam_id', fakeResponse(200, { user: { username: 'x' } }), 'IMPORT_SOURCE_FORMAT_CHANGED'],
    ['steam_id numérico', fakeResponse(200, { user: { steam_id: 76561190000000001 } }), 'IMPORT_SOURCE_FORMAT_CHANGED'],
  ])('erro %s', (_name, step, code) => {
    test(`-> 502 ${code} com params.source, sem vazar a chave, e o app segue funcionando`, async () => {
      await putKey(KEY);
      useApp(step);
      const res = await test_();
      expectError(res, 502, code);
      expect(res.body.error.params.source).toBe('CSFLOAT');
      if (code === 'IMPORT_RATE_LIMITED') expect(res.body.error.params.retryAt).toEqual(expect.any(String));
      expect(JSON.stringify(res.body)).not.toContain(KEY);
      // o resto do app não é derrubado
      expect((await request(app).get('/api/health')).status).toBe(200);
      expect((await get()).status).toBe(200);
      expect(integrationRow().account_fingerprint).toBeNull();
    });
  });
});

describe('POST switch-account (D293)', () => {
  test('sem confirmação -> 400 CONFIRMATION_REQUIRED e nenhuma chamada de rede', async () => {
    await putKey(KEY);
    expectError(await switchAcc({}), 400, 'CONFIRMATION_REQUIRED');
    expectError(await switchAcc({ confirm: false }), 400, 'CONFIRMATION_REQUIRED');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  test('confirm que não é booleano -> INVALID_FIELD; campo extra -> UNKNOWN_FIELD', async () => {
    expectError(await switchAcc({ confirm: 'sim' }), 400, 'INVALID_FIELD', { field: 'confirm' });
    expectError(await switchAcc({ confirm: true, x: 1 }), 400, 'UNKNOWN_FIELD');
  });
  test('sem chave -> 409 CSFLOAT_API_KEY_REQUIRED', async () => {
    expectError(await switchAcc(), 409, 'CSFLOAT_API_KEY_REQUIRED');
  });
  test('mesma conta -> 409 CSFLOAT_ACCOUNT_NOT_CHANGED e nada muda', async () => {
    await putKey(KEY);
    await test_();
    const before = integrationRow();
    expectError(await switchAcc(), 409, 'CSFLOAT_ACCOUNT_NOT_CHANGED');
    expect(integrationRow()).toEqual(before);
  });
  test('conta nova: zera cortes, cursor e last_import_*, pausa o automático; mantém chave, loja e autoImportOnOpen', async () => {
    await putKey(KEY);
    await test_();
    getDb().prepare(
      `UPDATE integrations SET trades_cutoff_at = '2026-01-01T00:00:00.000Z', transactions_cutoff_at = '2026-01-02T00:00:00.000Z',
        last_transaction_id = 'tx-ficticia-1', last_import_at = '2026-11-01T00:00:00.000Z', last_import_status = 'FAILED',
        last_import_error_code = 'IMPORT_RATE_LIMITED', auto_import_on_open = 1, auto_import_paused = 0`,
    ).run();
    const before = integrationRow();
    useApp(okMe({ user: { steam_id: PII.steamId2, username: PII.username2 } }));
    const res = await switchAcc();
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe(PII.username2);
    expect(res.body.data.integration).toMatchObject({
      hasApiKey: true, apiKeyMasked: '••••••••a1b2', storeId: storeId('CSFloat'), accountLinked: true,
      autoImportOnOpen: true, autoImportPaused: true, tradesCutoffAt: null, transactionsCutoffAt: null,
      lastImportAt: null, lastImportStatus: null, lastImportErrorCode: null,
    });
    const after = integrationRow();
    expect(after).toMatchObject({
      api_key: KEY, store_id: before.store_id, auto_import_on_open: 1, auto_import_paused: 1, trades_cutoff_at: null,
      transactions_cutoff_at: null, last_transaction_id: null, last_import_at: null, last_import_status: null, last_import_error_code: null,
    });
    expect(after.account_fingerprint).not.toBe(before.account_fingerprint);
    expect(after.account_salt).not.toBe(before.account_salt);
    expect(after.account_fingerprint).toBe(integrationService.computeFingerprint(PII.steamId2, after.account_salt));
    // depois da troca, o teste confirma a conta nova
    const confirm = await test_();
    expect(confirm.body.data).toMatchObject({ accountMatches: true, accountLinkedNow: false });
  });
  test('sem impressão digital gravada funciona como a primeira ligação', async () => {
    await putKey(KEY);
    const res = await switchAcc();
    expect(res.status).toBe(200);
    expect(res.body.data.integration.accountLinked).toBe(true);
    expect(integrationRow().auto_import_paused).toBe(1);
  });
  test('erros de rede do CSFloat sobem como 502 e não alteram nada', async () => {
    await putKey(KEY);
    await test_();
    const before = integrationRow();
    useApp(fakeResponse(401, {}));
    expectError(await switchAcc(), 502, 'CSFLOAT_AUTH_FAILED');
    expect(integrationRow()).toEqual(before);
  });
});

describe('integrationService.testConnection / switchAccount sem HTTP (D293: bloqueio por conta alterada)', () => {
  test('depois do teste que acusa conta diferente, "trocar" aceita e a conta antiga passa a ser a diferente', async () => {
    await putKey(KEY);
    await test_();
    useApp(okMe({ user: { steam_id: PII.steamId2 } }));
    expect((await test_()).body.data.accountMatches).toBe(false);
    expect((await switchAcc()).status).toBe(200);
    useApp(okMe());
    expect((await test_()).body.data.accountMatches).toBe(false);
  });
});

describe('segurança das rotas novas', () => {
  const writes = [
    ['patch', BASE, { storeId: null }],
    ['put', `${BASE}/api-key`, { apiKey: KEY }],
    ['post', `${BASE}/test`, {}],
    ['post', `${BASE}/switch-account`, { confirm: true }],
  ];
  test.each(writes)('%s %s sem Content-Type JSON -> 415 e nada muda', async (method, url, body) => {
    const before = integrationRow();
    expectError(await call(request(app)[method](url)), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await call(request(app)[method](url).set('Content-Type', 'text/plain').send(JSON.stringify(body))), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await call(request(app)[method](url).set('Content-Type', 'application/x-www-form-urlencoded').send('apiKey=x')), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expect(integrationRow()).toEqual(before);
    expect(fetchFn).not.toHaveBeenCalled();
  });
  test('PUT com a chave em text/plain não grava a chave', async () => {
    await call(request(app).put(`${BASE}/api-key`).set('Content-Type', 'text/plain').send(JSON.stringify({ apiKey: KEY })));
    expect(integrationRow().api_key).toBeNull();
  });
  test.each([
    ['get', BASE], ['patch', BASE], ['put', `${BASE}/api-key`], ['delete', `${BASE}/api-key`], ['post', `${BASE}/test`], ['post', `${BASE}/switch-account`],
  ])('%s %s com Host estranho -> 403 FORBIDDEN_HOST', async (method, url) => {
    for (const host of ['evil.com', 'localhost.evil.com', '192.168.0.10:3001']) {
      const res = await call(request(app)[method](url).set('Host', host).set('Content-Type', JSON_TYPE).send(method === 'get' || method === 'delete' ? undefined : {}));
      expectError(res, 403, 'FORBIDDEN_HOST');
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });
  test('DELETE da chave com Host estranho não remove a chave', async () => {
    await putKey(KEY);
    await call(request(app).delete(`${BASE}/api-key`).set('Host', 'evil.com'));
    expect(integrationRow().api_key).toBe(KEY);
  });
  test('Host 127.0.0.1 e localhost passam', async () => {
    expect((await call(request(app).get(BASE).set('Host', '127.0.0.1:3001'))).status).toBe(200);
    expect((await call(request(app).get(BASE).set('Host', 'localhost:3000'))).status).toBe(200);
  });
});

describe('sentinela: a chave nunca vai para log nem para resposta de erro', () => {
  test('fluxo completo (salvar, testar com cada erro, trocar, remover) não deixa a chave nem dados pessoais no console', async () => {
    await putKey(KEY);
    for (const step of [
      okMe(), fakeResponse(401, {}), fakeResponse(500, 'x'), () => { throw new Error(`falha ${KEY} ${PII.email}`); },
      fakeResponse(200, '{"user":'), fakeResponse(429, {}, { 'X-RateLimit-Reset': 999 }),
    ]) {
      useApp(step);
      await test_();
    }
    useApp(okMe({ user: { steam_id: PII.steamId2 } }));
    await switchAcc();
    await delKey();
    // as verificações finais rodam no afterEach (respostas, console e banco)
    expect(consoleOutput()).not.toContain('SENTINEL');
  });
  test('erro interno inesperado com a chave na mensagem não chega à resposta', async () => {
    await putKey(KEY);
    useApp(() => { throw new Error(`boom ${KEY}`); });
    const res = await test_();
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });
});
