'use strict';

// Integração com lojas externas (D286, D289, D293, D314, D316). Na 9.1: chave da API, loja, teste de conexão e troca de
// conta do CSFloat. Regra de negócio aqui; o Adapter fala com a rede e o model com o banco.
// A chave NUNCA sai deste service para fora do processo: a visão pública só leva `hasApiKey` e a máscara, e nenhuma
// mensagem de erro repete o valor.
const crypto = require('crypto');
const Integration = require('../models/Integration');
const Store = require('../models/Store');
const ImportBatch = require('../models/ImportBatch');
const ImportBatchEntry = require('../models/ImportBatchEntry');
const csfloatAdapter = require('./imports/adapters/csfloatAdapter');
const importLock = require('./imports/importLock');
const cutoffService = require('./imports/cutoffService');
const externalLinkService = require('./externalLinkService');
const { AppError, ValidationError, ConflictError } = require('../errors/AppError');
const {
  API_KEY_MIN_LENGTH,
  API_KEY_MAX_LENGTH,
  CSFLOAT_HELP_URL,
  CSFLOAT_TEST_TOTAL_TIMEOUT_MS,
} = require('../config/constants');

const SOURCE = 'CSFLOAT';
const MASK = '••••••••';
const ADAPTERS = Object.freeze({ [SOURCE]: csfloatAdapter });

// --- Funções puras ------------------------------------------------------------------------------

// "••••••••" + os 4 últimos caracteres; chave de 8 caracteres ou menos fica só com os pontos.
function maskApiKey(key) {
  if (typeof key !== 'string' || key === '') return null;
  return key.length <= API_KEY_MIN_LENGTH ? MASK : `${MASK}${key.slice(-4)}`;
}

// trim; recusa não texto, espaço interno e tamanho fora de 8 a 512. A mensagem nunca repete o valor.
function normalizeApiKey(raw) {
  const invalid = () =>
    new ValidationError(
      `A chave deve ter de ${API_KEY_MIN_LENGTH} a ${API_KEY_MAX_LENGTH} caracteres, sem espaços.`,
      'INVALID_API_KEY_FORMAT',
      { field: 'apiKey' }
    );
  if (typeof raw !== 'string') throw invalid();
  const key = raw.trim();
  if (key.length < API_KEY_MIN_LENGTH || key.length > API_KEY_MAX_LENGTH || /\s/.test(key)) throw invalid();
  return key;
}

// HMAC-SHA256 (hex) do Steam ID com o sal da instalação (hex de 32 bytes). Só serve para detectar troca de conta (D309).
function computeFingerprint(steamId, saltHex) {
  return crypto.createHmac('sha256', Buffer.from(String(saltHex), 'hex')).update(String(steamId)).digest('hex');
}

// A conta da chave é a ligada? Sem impressão digital gravada, qualquer conta serve (a primeira vez grava).
function accountMatchesRow(account, row) {
  return row.accountFingerprint === null || computeFingerprint(account.steamId, row.accountSalt) === row.accountFingerprint;
}

// Compara as taxas da conta (`/me`) com as da loja no app (D314), tolerância 0. Sem loja: tudo nulo. Taxa nula de um lado:
// `matches: null` (não há o que comparar).
function buildFeeCheck(account, store) {
  const compare = (accountRate, storeRate) => {
    if (!store || accountRate === null || accountRate === undefined || storeRate === null || storeRate === undefined) return null;
    return accountRate === storeRate;
  };
  const accountSale = account && account.saleFeeRate !== undefined ? account.saleFeeRate : null;
  const accountWithdrawal = account && account.withdrawalFeeRate !== undefined ? account.withdrawalFeeRate : null;
  const storeSale = store ? store.saleFeeRate ?? null : null;
  const storeWithdrawal = store ? store.withdrawalFeeRate ?? null : null;
  return {
    accountSaleFeeRate: accountSale,
    storeSaleFeeRate: storeSale,
    saleFeeMatches: compare(accountSale, storeSale),
    accountWithdrawalFeeRate: accountWithdrawal,
    storeWithdrawalFeeRate: storeWithdrawal,
    withdrawalFeeMatches: compare(accountWithdrawal, storeWithdrawal),
  };
}

// --- Visão pública ------------------------------------------------------------------------------

function getAdapter(source) {
  const adapter = ADAPTERS[source];
  if (!adapter) throw new AppError(404, 'INTEGRATION_NOT_FOUND', 'Integração não encontrada.');
  return adapter;
}

// Loja que o seed ligaria (D317): nome "CSFloat" (sem diferenciar maiúsculas), em US$, a de menor id.
function findDefaultStore() {
  return Store.findAll().filter((s) => s.currency === 'USD' && s.name.toLowerCase() === 'csfloat').sort((a, b) => a.id - b.id)[0] || null;
}

// Lê a integração. Sem loja ligada (ex.: a loja foi excluída, ON DELETE SET NULL), religa sozinha à loja "CSFloat" em US$ (D317).
// O vínculo continua por id: renomear a loja não o quebra, e loja "CSFloat" em outra moeda nunca é religada.
function loadRow(source, { relink = true, now = new Date() } = {}) {
  const row = Integration.get(source);
  if (!row) throw new AppError(404, 'INTEGRATION_NOT_FOUND', 'Integração não encontrada.');
  if (relink && row.storeId === null) {
    const store = findDefaultStore();
    if (store) return Integration.update(source, { storeId: store.id }, { now });
  }
  return row;
}

function toView(row, source) {
  const store = row.storeId ? Store.findById(row.storeId) : null;
  const key = row.hasApiKey ? Integration.getApiKey(source) : null;
  return {
    source,
    storeId: store ? store.id : null,
    storeName: store ? store.name : null,
    storeCurrency: store ? store.currency : null,
    storeSaleFeeRate: store ? store.saleFeeRate ?? null : null,
    storeWithdrawalFeeRate: store ? store.withdrawalFeeRate ?? null : null,
    hasApiKey: row.hasApiKey,
    apiKeyMasked: maskApiKey(key),
    apiKeySavedAt: row.hasApiKey ? row.apiKeySavedAt : null,
    accountLinked: row.accountFingerprint !== null,
    autoImportOnOpen: row.autoImportOnOpen,
    autoImportPaused: row.autoImportPaused,
    tradesCutoffAt: row.tradesCutoffAt,
    lastImportAt: row.lastImportAt,
    lastImportStatus: row.lastImportStatus,
    lastImportErrorCode: row.lastImportErrorCode,
    importInProgress: importLock.isImportInProgress(),
    // Pausada por desfazer (D302): a data do último lote desfeito, para a tela explicar o motivo; sem ele, foi a troca de conta.
    lastUndoneAt: row.autoImportPaused ? ImportBatch.findLatestUndoneAt(source) : null,
    openEntriesCount: ImportBatchEntry.countOpen(),
    // Só o valor inicial do campo da primeira importação (D296); depois que o corte existe, não há sugestão.
    suggestedCutoffAt: row.tradesCutoffAt === null && store ? cutoffService.suggest({ storeId: store.id }) : null,
    helpUrl: CSFLOAT_HELP_URL,
  };
}

function getStatus({ source = SOURCE } = {}) {
  getAdapter(source);
  return toView(loadRow(source), source);
}

function requireStoreForIntegration(storeId) {
  const store = Store.findById(storeId);
  if (!store) throw new ValidationError('Loja não encontrada.', 'STORE_NOT_FOUND', { field: 'storeId' });
  if (store.currency !== 'USD') {
    throw new ValidationError('A loja da integração precisa ser em dólar (US$).', 'IMPORT_STORE_CURRENCY_NOT_ALLOWED', { field: 'storeId' });
  }
  return store;
}

// `storeId` (a loja precisa existir e ser em US$), `autoImportOnOpen` e `autoImportPaused: false` (9.5, D303). A pausa (depois
// de desfazer um lote ou trocar de conta) só sai por ação do usuário: "Reativar", ou ligar de novo a opção.
function updateSettings(partial, { source = SOURCE, now = new Date() } = {}) {
  getAdapter(source);
  const current = loadRow(source, { relink: false });
  const patch = {};
  if (partial.autoImportOnOpen !== undefined) {
    patch.autoImportOnOpen = partial.autoImportOnOpen === true;
    if (patch.autoImportOnOpen && !current.autoImportOnOpen) patch.autoImportPaused = false;
  }
  if (partial.autoImportPaused === false) patch.autoImportPaused = false;
  if (partial.storeId !== undefined) {
    if (partial.storeId !== null) {
      if (!Number.isInteger(partial.storeId) || partial.storeId <= 0) {
        throw new ValidationError('storeId deve ser um inteiro positivo ou nulo.', 'INVALID_FIELD', { field: 'storeId' });
      }
      requireStoreForIntegration(partial.storeId);
    }
    patch.storeId = partial.storeId;
  }
  Integration.update(source, patch, { now });
  return toView(loadRow(source, { relink: false }), source);
}

function saveApiKey(apiKey, { source = SOURCE, now = new Date() } = {}) {
  getAdapter(source);
  loadRow(source);
  const key = normalizeApiKey(apiKey);
  Integration.update(source, { apiKey: key, apiKeySavedAt: now.toISOString() }, { now });
  return toView(loadRow(source), source);
}

// Idempotente. A impressão digital da conta continua (a troca de conta é detectada no próximo teste).
function removeApiKey({ source = SOURCE, now = new Date() } = {}) {
  getAdapter(source);
  loadRow(source);
  Integration.update(source, { apiKey: null, apiKeySavedAt: null }, { now });
  return toView(loadRow(source), source);
}

// Uso interno (chamadas ao CSFloat); nunca é devolvida por rota nenhuma.
function getApiKeyForCall(source = SOURCE) {
  return Integration.getApiKey(source);
}

function requireApiKey(source) {
  const key = getApiKeyForCall(source);
  if (!key) throw new ConflictError('Salve a chave do CSFloat primeiro.', 'CSFLOAT_API_KEY_REQUIRED');
  return key;
}

// Chama `GET /me` com o prazo total do teste; o temporizador sempre é limpo.
async function fetchAccount(source, { fetchFn, nowFn }) {
  const apiKey = requireApiKey(source);
  const controller = new AbortController();
  const totalTimeoutMs = CSFLOAT_TEST_TOTAL_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), totalTimeoutMs);
  try {
    return await getAdapter(source).getAccount({
      apiKey,
      fetchFn,
      totalSignal: controller.signal,
      totalDeadlineAt: Date.now() + totalTimeoutMs,
      nowFn,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Recusa se a chave é de outra conta que a ligada (D293). A importação usa a mesma regra do "Testar conexão".
function assertSameAccount(account, row) {
  if (!accountMatchesRow(account, row)) {
    throw new ConflictError('A chave é de outra conta CSFloat. Use "Trocar de conta" nas configurações.', 'CSFLOAT_ACCOUNT_CHANGED');
  }
}

// Primeira vez: grava o sal e a impressão digital da conta (nunca o Steam ID). Devolve true se ligou agora.
function ensureAccountLinked(account, row, { source = SOURCE, now = new Date() } = {}) {
  if (row.accountFingerprint !== null) return false;
  const salt = crypto.randomBytes(32).toString('hex');
  Integration.update(source, { accountSalt: salt, accountFingerprint: computeFingerprint(account.steamId, salt) }, { now });
  return true;
}

// "Testar conexão" (D288): GET /me. Primeira vez grava só a impressão digital da conta (o nome nunca é gravado).
async function testConnection({ source = SOURCE, fetchFn, now = new Date(), nowFn } = {}) {
  const row = loadRow(source);
  const account = await fetchAccount(source, { fetchFn, nowFn });
  const accountLinkedNow = ensureAccountLinked(account, row, { source, now });
  const accountMatches = accountLinkedNow ? true : accountMatchesRow(account, row);
  const current = loadRow(source, { now });
  const store = current.storeId ? Store.findById(current.storeId) : null;
  return {
    ok: true,
    checkedAt: now.toISOString(),
    username: account.username,
    accountMatches,
    accountLinkedNow,
    feeCheck: buildFeeCheck(account, store),
  };
}

// "Trocar de conta" (D293): grava a impressão digital da conta da chave atual e recomeça como numa primeira importação.
async function switchAccount({ source = SOURCE, confirm, fetchFn, now = new Date(), nowFn } = {}) {
  const row = loadRow(source);
  if (confirm !== true) throw new ValidationError('Confirme a operação.', 'CONFIRMATION_REQUIRED', { field: 'confirm' });
  importLock.assertIdle();
  const account = await fetchAccount(source, { fetchFn, nowFn });
  importLock.assertIdle(); // uma importação pode ter começado durante a chamada
  if (row.accountFingerprint !== null && accountMatchesRow(account, row)) {
    throw new ConflictError('A chave é da mesma conta já ligada; não há o que trocar.', 'CSFLOAT_ACCOUNT_NOT_CHANGED');
  }
  const salt = crypto.randomBytes(32).toString('hex');
  // Os trades abertos da conta anterior viram IGNORED na mesma transação da troca (D293).
  Integration.resetForAccountSwitch(source, { fingerprint: computeFingerprint(account.steamId, salt), salt }, {
    now,
    alsoInTransaction: () => externalLinkService.ignoreOpenForAccountSwitch({ source, now }),
  });
  return { integration: toView(loadRow(source), source), username: account.username };
}

// --- Backup (D290) ------------------------------------------------------------------------------

// Chaves atuais, guardadas só em memória durante a importação de um backup.
function captureSecrets() {
  return Integration.readSecrets();
}

// Regrava a chave atual depois de trocar o banco (nula se não havia). Qualquer chave vinda do arquivo é sobrescrita.
function restoreSecrets(secrets, { now = new Date() } = {}) {
  for (const source of Object.keys(ADAPTERS)) {
    const key = secrets && typeof secrets[source] === 'string' ? secrets[source] : null;
    Integration.writeSecret(source, key, { now });
  }
}

module.exports = {
  SOURCE,
  maskApiKey,
  normalizeApiKey,
  computeFingerprint,
  buildFeeCheck,
  getAdapter,
  loadRow,
  requireApiKey,
  fetchAccount,
  assertSameAccount,
  ensureAccountLinked,
  getStatus,
  updateSettings,
  saveApiKey,
  removeApiKey,
  testConnection,
  switchAccount,
  getApiKeyForCall,
  captureSecrets,
  restoreSecrets,
};
