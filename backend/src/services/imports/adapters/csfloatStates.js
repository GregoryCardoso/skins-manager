'use strict';

// Listas do CSFloat usadas pela importação (D294, D318). Ficam no Adapter: ajustar um nome ou um número aqui não muda o service.

// `state` do trade. Só estes nomes são "conhecidos"; qualquer outro vira UNKNOWN_STATE (nunca importa por segurança).
const CSFLOAT_TRADE_STATES = Object.freeze({
  done: Object.freeze(['verified']),
  failed: Object.freeze(['failed', 'cancelled']),
  open: Object.freeze(['queued', 'pending']),
});

// `steam_offer.state` (enum público da Steam, ETradeOfferState). Só o 3 (Accepted) foi confirmado nos dados; o 1 (Invalid) é
// tratado como desconhecido (D294).
const STEAM_OFFER_STATES = Object.freeze({
  accepted: 3,
  known: Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
});

// Tipos de transação do extrato conhecidos (D294, D306). Os demais só são contados em `unknown_types_json`.
const KNOWN_TX_TYPES = Object.freeze([
  'contract_purchased', 'contract_sold', 'trade_verified', 'bid_posted', 'bid_accepted', 'deposit', 'withdrawal', 'fine',
  'contract_purchase_refund', 'contract_sale_refund', 'rollback',
]);

// Transações que, com o mesmo `contract_id`, indicam que uma compra foi desfeita (D294).
const PURCHASE_REVERSAL_TX_TYPES = Object.freeze(['contract_purchase_refund', 'rollback']);

// Transações que, com o mesmo `contract_id`, indicam que uma venda foi desfeita (D294, D301).
const SALE_REVERSAL_TX_TYPES = Object.freeze(['contract_sale_refund', 'rollback']);

// `paint_index` das fases da Doppler e da Gamma Doppler (conhecidas do jogo; "conferir com exemplo real", D318).
const DOPPLER_PHASES = Object.freeze({
  415: 'Ruby',
  416: 'Sapphire',
  417: 'Black Pearl',
  418: 'Phase 1',
  419: 'Phase 2',
  420: 'Phase 3',
  421: 'Phase 4',
  568: 'Emerald',
  569: 'Phase 1',
  570: 'Phase 2',
  571: 'Phase 3',
  572: 'Phase 4',
});

module.exports = { CSFLOAT_TRADE_STATES, STEAM_OFFER_STATES, KNOWN_TX_TYPES, PURCHASE_REVERSAL_TX_TYPES, SALE_REVERSAL_TX_TYPES, DOPPLER_PHASES };
