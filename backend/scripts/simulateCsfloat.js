'use strict';

// Simulador do CSFloat para o banco de DEMONSTRAÇÃO (9.4): roda a importação de verdade (importService.runImport) com respostas
// falsas do CSFloat, para ver no navegador trades revertidos, "Remover lançamento", "Manter" e os outros casos sem precisar de um
// trade revertido real. NUNCA abre o banco real: só aceita backend/data/inventory.dev.sqlite (a mesma trava do seed:dev, D108).
// Nenhuma chamada de rede é feita; todos os dados são inventados.
//
//   npm run seed:dev                      (cria o banco de demonstração, se ainda não existir)
//   npm run dev:demo                      (sobe o app com ele, em outro terminal)
//   npm --prefix backend run sim:csfloat -- <etapa>
//
// Etapas (rode na ordem; cada uma é uma importação):
//   compra             duas compras: uma ainda na proteção (A) e uma já fora dela (B)
//   reverter-compra    a compra A volta "failed" no CSFloat              -> "Trade revertido" (compra)
//   venda              a unidade B é vendida no CSFloat                  -> venda importada
//   reverter-venda     o extrato traz um estorno da venda de B           -> "Trade revertido" (venda)
//   antes-de-importar  um trade aceito e cancelado antes de importar     -> contagem "revertido antes de importar"
//   desconhecido       um trade aceito com estado novo                   -> "Estado desconhecido" (tentado de novo)
const devDb = require('./devDb');

const STAGES = ['compra', 'reverter-compra', 'venda', 'reverter-venda', 'antes-de-importar', 'desconhecido'];
const DAY_MS = 86400000;
const ME = '76561190000000001'; // Steam ID inventado
const OTHER = '76561190000000099';
const FAKE_KEY = 'SIMULADOR-DEMO-0000000000000000';

// Datas fixas no dia (UTC), para as etapas rodadas no mesmo dia baterem entre si. `now` é injetável (testes).
let today = new Date();
const anchor = (now) => {
  today = new Date(now.getTime());
  today.setUTCHours(12, 0, 0, 0);
};
const at = (days, hours = 0) => new Date(today.getTime() + days * DAY_MS + hours * 3600000).toISOString();

const AK = (floatValue, paintSeed) => ({
  market_hash_name: 'AK-47 | Redline (Field-Tested)', item_name: 'Redline', wear_name: 'Field-Tested', type: 'skin', is_commodity: false,
  def_index: 7, paint_index: 282, float_value: floatValue, paint_seed: paintSeed, phase: null, is_stattrak: false, is_souvenir: false,
});

function trade({ id, direction, state, createdAt, protectionEndsAt, verifySaleAt = null, price, item }) {
  return {
    id, contract_id: `9${id}`, buyer_id: direction === 'BUY' ? ME : OTHER, seller_id: direction === 'BUY' ? OTHER : ME, state,
    created_at: createdAt, accepted_at: createdAt, trade_protection_ends_at: protectionEndsAt, verify_sale_at: verifySaleAt,
    sent_to_different_user_id: null, steam_offer: { state: 3 }, contract: { price, type: 'buy_now', sold_at: createdAt, item },
  };
}
const tx = (id, type, createdAt, { balance = 0, pending = 0, details = {} }) => ({
  id, type, created_at: createdAt, balance_offset: balance, pending_offset: pending, details,
});

// A: compra recente, ainda na proteção. B: compra antiga, já fora da proteção (pode ser vendida). S: venda de B.
const A = (state) => trade({ id: '7100001', direction: 'BUY', state, createdAt: at(-1), protectionEndsAt: at(6), price: 1250, item: AK(0.2511, 101) });
const B = () => trade({ id: '7100002', direction: 'BUY', state: 'verified', createdAt: at(-12), protectionEndsAt: at(-5), price: 1800, item: AK(0.3122, 202) });
const S = () => trade({
  id: '7100003', direction: 'SELL', state: 'pending', createdAt: at(-1, 2), protectionEndsAt: at(6), verifySaleAt: at(6, 2), price: 2500, item: AK(0.3122, 202),
});
const Q = () => trade({ id: '7100004', direction: 'BUY', state: 'cancelled', createdAt: at(-2), protectionEndsAt: at(5), price: 900, item: AK(0.4011, 303) });
const U = () => trade({ id: '7100005', direction: 'BUY', state: 'held_by_support', createdAt: at(-2, 1), protectionEndsAt: at(5), price: 950, item: AK(0.4522, 404) });

const purchases = [
  tx('sim-tx-1', 'contract_purchased', at(-1, 0.01), { balance: -1250, details: { contract_id: '97100001' } }),
  tx('sim-tx-2', 'contract_purchased', at(-12, 0.01), { balance: -1800, details: { contract_id: '97100002' } }),
];
const sold = tx('sim-tx-3', 'contract_sold', at(-1, 2.01), { pending: 2450, details: { contract_id: '97100003', fee_amount: '50' } });
const saleRefund = tx('sim-tx-4', 'contract_sale_refund', at(0, -1), { pending: -2450, details: { contract_id: '97100003' } });

function scenario(name) {
  switch (name) {
    case 'compra': return { trades: [A('pending'), B()], transactions: purchases };
    case 'reverter-compra': return { trades: [A('failed'), B()], transactions: purchases };
    case 'venda': return { trades: [S(), B()], transactions: [sold, ...purchases] };
    case 'reverter-venda': return { trades: [S(), B()], transactions: [saleRefund, sold, ...purchases] };
    case 'antes-de-importar': return { trades: [Q()], transactions: purchases };
    default: return { trades: [U()], transactions: purchases };
  }
}

// fetchFn falso: o mesmo formato mínimo que o csfloatHttp usa (status, headers.get, text).
function fakeFetch({ trades, transactions }) {
  const byNewest = (list) => [...list].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const response = (body) => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });
  return async (url) => {
    const parsed = new URL(url);
    const pathName = parsed.pathname.replace(/^\/api\/v1/, '');
    const page = Number(parsed.searchParams.get('page') || 0);
    const limit = Number(parsed.searchParams.get('limit') || 50);
    const slice = (list) => byNewest(list).slice(page * limit, (page + 1) * limit);
    if (pathName === '/me') return response({ user: { steam_id: ME, balance: 0, pending_balance: 0, fee: '0.02', withdraw_fee: '0.025' } });
    if (pathName === '/me/trades') return response({ trades: slice(trades), count: trades.length });
    if (pathName === '/me/transactions') return response({ transactions: slice(transactions), count: transactions.length });
    return { status: 404, headers: { get: () => null }, text: async () => '{}' };
  };
}

// Roda uma etapa no banco já configurado (`DB_PATH`). Devolve o lote. Os módulos de src/ só são carregados aqui, depois do
// `DB_PATH` definido.
async function runStage(stage, { now = new Date() } = {}) {
  if (!STAGES.includes(stage)) throw new Error(`Informe a etapa: ${STAGES.join(' | ')}`);
  const integrationService = require('../src/services/integrationService');
  const importService = require('../src/services/imports/importService');
  const Integration = require('../src/models/Integration');
  anchor(now);
  const row = integrationService.loadRow('CSFLOAT');
  if (!row.storeId) throw new Error('O banco de demonstração não tem a loja "CSFloat" em US$. Rode npm run seed:dev de novo.');
  if (!integrationService.getApiKeyForCall('CSFLOAT')) integrationService.saveApiKey(FAKE_KEY, { now });
  const firstImport = Integration.get('CSFLOAT').tradesCutoffAt === null;
  const { batch } = await importService.runImport({
    trigger: 'MANUAL', cutoffAt: firstImport ? at(-30) : undefined, fetchFn: fakeFetch(scenario(stage)), sleepFn: async () => {}, now,
  });
  return batch;
}

async function main() {
  const stage = process.argv[2];
  if (!STAGES.includes(stage)) throw new Error(`Informe a etapa: ${STAGES.join(' | ')}`);
  const target = devDb.resolveSeedTarget({ argv: [] }); // recusa se o banco de demonstração coincidir com o real
  if (!require('fs').existsSync(target)) throw new Error('O banco de demonstração ainda não existe. Rode primeiro: npm run seed:dev');
  process.env.DB_PATH = target; // antes de carregar qualquer módulo de src/
  const { getDb } = require('../src/config/database');
  getDb();
  const batch = await runStage(stage);
  const counts = Object.entries(batch.counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(', ');
  console.log(`Etapa "${stage}": lote #${batch.id} (${counts || 'nada novo'})`);
  for (const e of batch.entries) console.log(`  - ${e.outcome}${e.reasonCode ? ` ${e.reasonCode}` : ''} ${e.display.name || e.display.marketHashName || ''}`);
  console.log('Abra (ou recarregue) a página Importações no navegador para ver as pendências.');
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(`Falhou: ${err.code ? `${err.code} - ` : ''}${err.message}`);
      if (err.code === 'CSFLOAT_ACCOUNT_CHANGED') console.error('Este banco de demonstração já foi ligado a outra conta. Rode npm run seed:dev para recriá-lo.');
      process.exitCode = 1;
    })
    .finally(() => {
      if (process.env.DB_PATH) require('../src/config/database').closeDb();
    });
}

module.exports = { STAGES, runStage };
