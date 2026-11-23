'use strict';

// Fixtures do CSFloat para os testes da 9.1 (não é arquivo de teste). TODOS os dados são INVENTADOS: nenhum Steam ID,
// nome, e-mail, telefone, token ou avatar é real. Nenhum teste faz chamada de rede real.

// Chave falsa marcada: se aparecer em resposta, mensagem, log ou backup, o teste falha. Termina em "a1b2" (máscara).
const KEY = 'SENTINEL-KEY-zq7r5k3m9x-a1b2';
const OTHER_KEY = 'SENTINEL-OTHER-w4n8v2c6p1-c3d4';

// Marcadores únicos de dados pessoais falsos (buscados em respostas, logs, banco e arquivos).
const PII = Object.freeze({
  steamId: '76561190000000001',
  steamId2: '76561190000000002',
  username: 'usuario_ficticio_qa',
  username2: 'outro_ficticio_qa',
  email: 'ficticio.qa@example.invalid',
  phone: '+00-555-0100-QA',
  tradeToken: 'TRADE-TOKEN-FICTICIO-QA',
  payment: 'PAYMENT-ACCT-FICTICIO-QA',
  stripe: 'STRIPE-FICTICIO-QA',
  avatar: 'https://avatars.example.invalid/ficticio-qa.jpg',
});

// Formato real do GET /me (valores inventados): `user.steam_id` em texto, taxas em texto/número, saldos em centavos.
function meBody(overrides = {}) {
  const user = {
    steam_id: PII.steamId,
    username: PII.username,
    avatar: PII.avatar,
    email: PII.email,
    phone_number: PII.phone,
    trade_token: PII.tradeToken,
    payment_accounts: [{ type: 'IBAN', value: PII.payment }],
    stripe_connect: { account_id: PII.stripe, verified: true },
    balance: 12345,
    pending_balance: 678,
    fee: '0.02',
    withdraw_fee: '0.025',
    statistics: {
      total_sales: 10,
      total_purchases: 5,
      total_trades: 61,
      total_verified_trades: 55,
      total_failed_trades: 4,
      total_avoided_trades: 2,
    },
    ...(overrides.user || {}),
  };
  const { user: _ignored, ...rest } = overrides;
  return { user, ...rest };
}

// Resposta falsa no formato mínimo que o csfloatHttp usa (status, headers.get em minúsculas, text/json).
function fakeResponse(status, body, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const text = typeof body === 'string' ? body : JSON.stringify(body === undefined ? {} : body);
  return {
    status,
    headers: { get: (name) => (Object.prototype.hasOwnProperty.call(lower, String(name).toLowerCase()) ? lower[String(name).toLowerCase()] : null) },
    text: async () => text,
  };
}

// fetchFn falso: devolve as respostas em sequência (a última se repete); funções são chamadas com (url, init).
function fakeFetch(...steps) {
  const calls = [];
  const fn = jest.fn(async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    return typeof step === 'function' ? step(url, init) : step;
  });
  fn.calls = calls;
  return fn;
}

const okMe = (overrides) => fakeResponse(200, meBody(overrides));

module.exports = { KEY, OTHER_KEY, PII, meBody, fakeResponse, fakeFetch, okMe };
