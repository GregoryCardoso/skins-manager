'use strict';

// QA 9.1 (D316, seção 7): funções puras do integrationService, mapper do CSFloat e contrato do Adapter.
const crypto = require('crypto');
const {
  maskApiKey, normalizeApiKey, computeFingerprint, buildFeeCheck,
} = require('../../src/services/integrationService');
const { mapAccount, parseCentsString, parseRate, parseNonNegativeInt, parseDigitsId } = require('../../src/services/imports/adapters/csfloatMapper');
const csfloatAdapter = require('../../src/services/imports/adapters/csfloatAdapter');
const { validateAdapter } = require('../../src/services/imports/importSource');
const { meBody, PII } = require('../helpers/csfloatFixtures');

describe('maskApiKey', () => {
  test('chave longa: 8 pontos + 4 últimos', () => {
    expect(maskApiKey('SENTINEL-KEY-zq7r5k3m9x-a1b2')).toBe('••••••••a1b2');
  });
  test('9 caracteres: pontos + 4 últimos', () => {
    expect(maskApiKey('123456789')).toBe('••••••••6789');
  });
  test('exatamente 8 (ou menos): só os pontos, sem vazar nada', () => {
    expect(maskApiKey('12345678')).toBe('••••••••');
    expect(maskApiKey('abc')).toBe('••••••••');
  });
  test('nulo, vazio e não texto -> null', () => {
    expect(maskApiKey(null)).toBeNull();
    expect(maskApiKey('')).toBeNull();
    expect(maskApiKey(undefined)).toBeNull();
    expect(maskApiKey(12345678)).toBeNull();
  });
});

describe('normalizeApiKey', () => {
  test('aceita 8 e 512 caracteres e remove espaços das pontas', () => {
    expect(normalizeApiKey('a'.repeat(8))).toBe('a'.repeat(8));
    expect(normalizeApiKey('b'.repeat(512))).toBe('b'.repeat(512));
    expect(normalizeApiKey('  \tchave-valida-1\n ')).toBe('chave-valida-1');
  });
  test.each([
    ['7 caracteres', 'a'.repeat(7)],
    ['513 caracteres', 'a'.repeat(513)],
    ['espaço interno', 'abcd efghij'],
    ['quebra de linha interna', 'abcdefgh\nijkl'],
    ['só espaços', '          '],
    ['vazio', ''],
    ['número', 12345678901],
    ['null', null],
    ['undefined', undefined],
    ['objeto', { a: 1 }],
  ])('recusa %s', (_n, raw) => {
    expect(() => normalizeApiKey(raw)).toThrow(expect.objectContaining({ code: 'INVALID_API_KEY_FORMAT', status: 400 }));
  });
  test('a mensagem de erro nunca repete o valor informado', () => {
    const secret = 'segredo com espaco interno';
    let caught = null;
    try {
      normalizeApiKey(secret);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught.message).not.toContain('segredo');
    expect(JSON.stringify(caught.params ?? {})).not.toContain('segredo');
  });
});

describe('computeFingerprint', () => {
  const salt = crypto.randomBytes(32).toString('hex');
  test('determinística, hex de 64 caracteres e igual a HMAC-SHA256 direto', () => {
    const a = computeFingerprint(PII.steamId, salt);
    expect(a).toBe(computeFingerprint(PII.steamId, salt));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(crypto.createHmac('sha256', Buffer.from(salt, 'hex')).update(PII.steamId).digest('hex'));
  });
  test('sal diferente ou Steam ID diferente -> valor diferente', () => {
    const other = crypto.randomBytes(32).toString('hex');
    expect(computeFingerprint(PII.steamId, other)).not.toBe(computeFingerprint(PII.steamId, salt));
    expect(computeFingerprint(PII.steamId2, salt)).not.toBe(computeFingerprint(PII.steamId, salt));
  });
  test('nunca contém o Steam ID', () => {
    expect(computeFingerprint(PII.steamId, salt)).not.toContain(PII.steamId);
  });
});

describe('buildFeeCheck (D314)', () => {
  const store = { saleFeeRate: 0.02, withdrawalFeeRate: 0.025 };
  test('taxas iguais -> matches true nas duas', () => {
    expect(buildFeeCheck({ saleFeeRate: 0.02, withdrawalFeeRate: 0.025 }, store)).toEqual({
      accountSaleFeeRate: 0.02, storeSaleFeeRate: 0.02, saleFeeMatches: true,
      accountWithdrawalFeeRate: 0.025, storeWithdrawalFeeRate: 0.025, withdrawalFeeMatches: true,
    });
  });
  test('taxa de venda diferente -> só ela é false (tolerância 0)', () => {
    const r = buildFeeCheck({ saleFeeRate: 0.015, withdrawalFeeRate: 0.025 }, store);
    expect(r.saleFeeMatches).toBe(false);
    expect(r.withdrawalFeeMatches).toBe(true);
    expect(r.accountSaleFeeRate).toBe(0.015);
    expect(r.storeSaleFeeRate).toBe(0.02);
  });
  test('diferença mínima (0.0200001) já é diferente', () => {
    expect(buildFeeCheck({ saleFeeRate: 0.0200001, withdrawalFeeRate: 0.025 }, store).saleFeeMatches).toBe(false);
  });
  test('sem loja -> nulos e matches null', () => {
    expect(buildFeeCheck({ saleFeeRate: 0.02, withdrawalFeeRate: 0.025 }, null)).toEqual({
      accountSaleFeeRate: 0.02, storeSaleFeeRate: null, saleFeeMatches: null,
      accountWithdrawalFeeRate: 0.025, storeWithdrawalFeeRate: null, withdrawalFeeMatches: null,
    });
  });
  test('taxa nula de um dos lados -> matches null (não há o que comparar)', () => {
    const r = buildFeeCheck({ saleFeeRate: null, withdrawalFeeRate: 0.025 }, { saleFeeRate: 0.02, withdrawalFeeRate: null });
    expect(r.saleFeeMatches).toBeNull();
    expect(r.withdrawalFeeMatches).toBeNull();
  });
  test('taxa zero é valor válido (0 === 0 casa, 0 vs 0.02 difere)', () => {
    expect(buildFeeCheck({ saleFeeRate: 0, withdrawalFeeRate: 0 }, { saleFeeRate: 0, withdrawalFeeRate: 0 }).saleFeeMatches).toBe(true);
    expect(buildFeeCheck({ saleFeeRate: 0, withdrawalFeeRate: 0 }, store).saleFeeMatches).toBe(false);
  });
});

describe('csfloatMapper.mapAccount (allowlist)', () => {
  test('formato real: converte e devolve só os campos permitidos', () => {
    expect(mapAccount(meBody())).toEqual({
      steamId: PII.steamId,
      username: PII.username,
      balanceCents: 12345,
      pendingBalanceCents: 678,
      saleFeeRate: 0.02,
      withdrawalFeeRate: 0.025,
      statistics: {
        totalSales: 10, totalPurchases: 5, totalTrades: 61, totalVerifiedTrades: 55, totalFailedTrades: 4, totalAvoidedTrades: 2,
      },
    });
  });
  test('campos sensíveis do fixture (e-mail, telefone, token, pagamentos, stripe, avatar) não saem do mapper', () => {
    const json = JSON.stringify(mapAccount(meBody()));
    for (const secret of [PII.email, PII.phone, PII.tradeToken, PII.payment, PII.stripe, PII.avatar]) {
      expect(json).not.toContain(secret);
    }
    expect(Object.keys(mapAccount(meBody())).sort()).toEqual(
      ['balanceCents', 'pendingBalanceCents', 'saleFeeRate', 'statistics', 'steamId', 'username', 'withdrawalFeeRate'],
    );
  });
  test('campo desconhecido novo no JSON é ignorado', () => {
    const account = mapAccount(meBody({ user: { campo_novo: 'x', other: { a: 1 } } }));
    expect(JSON.stringify(account)).not.toContain('campo_novo');
  });
  test('taxas em número e em texto são aceitas', () => {
    expect(mapAccount(meBody({ user: { fee: 0.03, withdraw_fee: '0.01' } }))).toMatchObject({ saleFeeRate: 0.03, withdrawalFeeRate: 0.01 });
  });
  test('taxa inválida (abc, 1, -0.1, 2, vazio, nulo, objeto) vira null sem derrubar', () => {
    for (const bad of ['abc', 1, '1', -0.1, 2, '', null, {}]) {
      expect(mapAccount(meBody({ user: { fee: bad } })).saleFeeRate).toBeNull();
    }
  });
  test('saldos inválidos (negativo, fracionário, texto) viram null', () => {
    const a = mapAccount(meBody({ user: { balance: -1, pending_balance: 1.5 } }));
    expect(a.balanceCents).toBeNull();
    expect(a.pendingBalanceCents).toBeNull();
    expect(mapAccount(meBody({ user: { balance: '100' } })).balanceCents).toBeNull();
  });
  test('statistics ausente ou inválida -> tudo null', () => {
    expect(mapAccount(meBody({ user: { statistics: 'x' } })).statistics.totalSales).toBeNull();
    expect(mapAccount(meBody({ user: { statistics: undefined } })).statistics.totalTrades).toBeNull();
  });
  test('username ausente/vazio/não texto -> null; username longo é cortado em 100', () => {
    expect(mapAccount(meBody({ user: { username: undefined } })).username).toBeNull();
    expect(mapAccount(meBody({ user: { username: '   ' } })).username).toBeNull();
    expect(mapAccount(meBody({ user: { username: 'x'.repeat(300) } })).username).toHaveLength(100);
    expect(mapAccount(meBody({ user: { username: 123 } })).username).toBeNull();
  });
  test.each([
    ['sem steam_id', { user: { steam_id: undefined } }],
    ['steam_id numérico (perderia precisão)', { user: { steam_id: 76561190000000001 } }],
    ['steam_id com letras', { user: { steam_id: '7656abc' } }],
    ['steam_id vazio', { user: { steam_id: '' } }],
    ['steam_id nulo', { user: { steam_id: null } }],
  ])('%s -> IMPORT_SOURCE_FORMAT_CHANGED', (_n, over) => {
    expect(() => mapAccount(meBody(over))).toThrow(expect.objectContaining({ code: 'IMPORT_SOURCE_FORMAT_CHANGED', status: 502 }));
  });
  test.each([[null], [undefined], ['texto'], [[]], [{}], [{ user: null }], [{ user: [] }], [{ user: 'x' }], [{ code: 27 }]])(
    'corpo %j sem objeto user -> IMPORT_SOURCE_FORMAT_CHANGED',
    (body) => {
      expect(() => mapAccount(body)).toThrow(expect.objectContaining({ code: 'IMPORT_SOURCE_FORMAT_CHANGED' }));
    },
  );
  test('o erro de formato não carrega o JSON recebido e traz params.source', () => {
    let caught = null;
    try {
      mapAccount({ user: { steam_id: 5, email: PII.email } });
    } catch (err) {
      caught = err;
    }
    expect(caught.params).toEqual({ source: 'CSFLOAT' });
    expect(caught.message).not.toContain(PII.email);
    expect(caught.cause).toBeUndefined();
  });
});

describe('parseCentsString / parseRate / auxiliares (prontos para a 9.2)', () => {
  test.each([
    ['20', 20], [20, 20], ['0', 0], [0, 0], ['123456789012', 123456789012],
  ])('parseCentsString(%j) = %j', (input, expected) => expect(parseCentsString(input)).toBe(expected));
  test.each([
    ['0.32'], ['-1'], ['abc'], [''], [null], [undefined], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 2], ['1234567890123'], [' 20'], ['2e3'], [{}], [true],
  ])('parseCentsString(%j) = null', (input) => expect(parseCentsString(input)).toBeNull());
  test('número seguro acima do teto de 12 dígitos é recusado', () => {
    expect(parseCentsString(1000000000000)).toBeNull();
  });
  test.each([
    ['0.02', 0.02], [0.025, 0.025], [0, 0], ['0', 0], [' 0.5 ', 0.5],
  ])('parseRate(%j) = %j', (input, expected) => expect(parseRate(input)).toBe(expected));
  test.each([[1], ['1'], [-0.01], ['-0.01'], ['abc'], [NaN], [Infinity], [null], [undefined], ['']])('parseRate(%j) = null', (input) => {
    expect(parseRate(input)).toBeNull();
  });
  test('parseNonNegativeInt e parseDigitsId', () => {
    expect(parseNonNegativeInt(0)).toBe(0);
    expect(parseNonNegativeInt(-1)).toBeNull();
    expect(parseNonNegativeInt(1.2)).toBeNull();
    expect(parseNonNegativeInt('1')).toBeNull();
    expect(parseDigitsId('123')).toBe('123');
    expect(parseDigitsId(123)).toBeNull();
    expect(parseDigitsId('1'.repeat(33))).toBeNull();
  });
});

describe('contrato do Adapter (D287)', () => {
  test('csfloatAdapter cumpre o contrato e declara conta, trades e extrato', () => {
    expect(validateAdapter(csfloatAdapter)).toEqual([]);
    expect(csfloatAdapter.id).toBe('CSFLOAT');
    expect(csfloatAdapter.capabilities).toEqual({ account: true, trades: true, transactions: true, valuation: true });
  });
  test('validateAdapter acusa problemas', () => {
    expect(validateAdapter(null)).toEqual(['adapter ausente']);
    expect(validateAdapter({ id: '', capabilities: null })).toEqual(['id', 'capabilities']);
    expect(validateAdapter({ id: 'X', capabilities: { account: true, trades: false, transactions: false } })).toEqual(['getAccount']);
    expect(validateAdapter({ id: 'X', capabilities: { account: 'sim', trades: false, transactions: false } })).toEqual(['capabilities.account']);
  });
});
