'use strict';

// Regras puras da abertura de caixas, cápsulas, pacotes e terminais (D363 item 3; 2.2.3, Revisão 31). Sem banco: recebem a unidade e a
// entrada do catálogo. Só a classificação e a compatibilidade entre caixa e chave.
const { normalizeSearchText } = require('../catalog/csgoApiAdapter');

const isNil = (v) => v === null || v === undefined;

// Chaves compartilhadas (E-P2-Q49(b)): cada chave abre só as caixas listadas, e essas caixas aceitam só essa chave. Nomes conferidos no
// catálogo embutido (crate-4001, 4004, 4010, 4002, 4005 e 4019).
const SHARED_CASE_KEYS = Object.freeze({
  'CS:GO Case Key': Object.freeze(['CS:GO Weapon Case', 'CS:GO Weapon Case 2', 'CS:GO Weapon Case 3']),
  'eSports Key': Object.freeze(['eSports 2013 Case', 'eSports 2013 Winter Case', 'eSports 2014 Summer Case']),
});

const norm = normalizeSearchText;
const SHARED_BY_KEY = new Map(Object.entries(SHARED_CASE_KEYS).map(([key, cases]) => [norm(key), new Set(cases.map(norm))]));
const SHARED_KEY_BY_CASE = new Map();
for (const [key, cases] of Object.entries(SHARED_CASE_KEYS)) for (const name of cases) SHARED_KEY_BY_CASE.set(norm(name), key);

const endsWith = (name, suffix) => typeof name === 'string' && name.trim().endsWith(suffix);

// "Operation Phoenix Weapon Case" e "Operation Phoenix Case" têm a mesma chave ("... Case Key"): "Weapon Case" vira "Case".
function withoutWeapon(name) {
  return String(name).trim().replace(/\bWeapon Case$/i, 'Case');
}

// A unidade é uma caixa de chave? "… Case" no catálogo ou uma das seis caixas da tabela (as de CS:GO 2 e 3 não terminam em " Case").
function isKeyedCase(caseName) {
  return endsWith(caseName, ' Case') || SHARED_KEY_BY_CASE.has(norm(caseName));
}

// Chave: item `OUTRO` de nome livre (sem catálogo; não há chaves no catálogo) terminado em " Key".
function isKey(item) {
  return Boolean(item) && item.category === 'OUTRO' && isNil(item.catalogId) && endsWith(item.name, ' Key');
}

// Caixa em estoque que pede chave (evita carregar as chaves quando a unidade não é uma).
function needsKey(item) {
  return Boolean(item) && item.category === 'CAIXA' && item.status === 'EM_ESTOQUE' && isKeyedCase(item.name);
}

// 'CASE' | 'NO_KEY' | 'TERMINAL' | null (D363 item 3). `entry`: a entrada do catálogo da unidade (com `source` e `category`).
function openingKindOf(item, entry) {
  if (!item || item.status !== 'EM_ESTOQUE' || isNil(item.catalogId) || !entry) return null;
  const name = item.name;
  if (entry.source === 'CRATES' && endsWith(name, ' Terminal')) return 'TERMINAL';
  if (item.category === 'CAIXA' && entry.category === 'CAIXA') return isKeyedCase(name) ? 'CASE' : 'NO_KEY'; // pacote Souvenir e Highlight
  if (item.category === 'CAPSULA' && entry.category === 'CAPSULA') return 'NO_KEY';
  if (item.category === 'OUTRO' && entry.source === 'CRATES' && endsWith(name, ' Package') && name.trim() !== 'Gift Package') return 'NO_KEY';
  return null;
}

// Nome sugerido da chave de uma caixa (atalho "Cadastrar chave"): "<X> Case" -> "<X> Case Key", com "Weapon Case" -> "Case"; as seis
// caixas da tabela sugerem a chave da tabela.
function caseKeyName(caseName) {
  const shared = SHARED_KEY_BY_CASE.get(norm(caseName));
  if (shared) return shared;
  return `${withoutWeapon(caseName)} Key`;
}

// A chave abre a caixa? Pelo nome (1 <-> 1, com "Weapon Case" = "Case") ou pela tabela das chaves compartilhadas.
function keyMatchesCase(keyName, caseName) {
  const keyKey = norm(keyName);
  const caseKey = norm(caseName);
  const sharedCases = SHARED_BY_KEY.get(keyKey);
  if (sharedCases) return sharedCases.has(caseKey);
  if (SHARED_KEY_BY_CASE.has(caseKey)) return false; // essas seis só aceitam a chave da tabela
  // "Weapon Case" vale como "Case" nos dois lados: a chave "... Weapon Case Key" também abre "... Weapon Case".
  return norm(String(keyName).trim().replace(/\bWeapon Case Key$/i, 'Case Key')) === norm(`${withoutWeapon(caseName)} Key`);
}

module.exports = { SHARED_CASE_KEYS, isKey, needsKey, isKeyedCase, openingKindOf, caseKeyName, keyMatchesCase };
