'use strict';

// Catálogo local de itens (D70, D80, D81, D82): download/refresh, snapshot embutido, busca e vínculo de legados.
const fs = require('fs');
const path = require('path');
const {
  CATALOG_BASE_URL, CATALOG_LANGUAGES, CATALOG_FILES, CATALOG_FETCH_TIMEOUT_MS, CATALOG_MAX_FILE_BYTES, CATALOG_SEARCH_DEFAULT_LIMIT,
  CATALOG_SEARCH_MAX_LIMIT, CATALOG_ID_MAX_LENGTH, CATALOG_SNAPSHOT_PATH, CATALOG_MIN_ROWS, CATALOG_MAX_SKIPPED_RATIO,
} = require('../config/constants');
const CatalogItem = require('../models/CatalogItem');
const Item = require('../models/Item');
const Setting = require('../models/Setting');
const { runInTransaction } = require('../models/modelHelpers');
const { ValidationError, NotFoundError, ConflictError, UpstreamError } = require('../errors/AppError');
const { CATEGORIES, CATALOG_CATEGORIES } = require('./itemAttributesService');
const { SOURCES, normalizeSearchText, buildSearchText, toSafeImageUrl, mapCatalog } = require('./catalog/csgoApiAdapter');

const SNAPSHOT_FORMAT_VERSION = 1;
const SNAPSHOT_SOURCE_URL = 'https://github.com/ByMykel/CSGO-API';
const SNAPSHOT_COLUMNS = Object.freeze([
  'id', 'source', 'category', 'name', 'namePtBr', 'imageUrl', 'minFloat', 'maxFloat', 'hasStattrak',
  'hasSouvenir', 'phase', 'rarity',
]);
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MIN_QUERY_LENGTH = 2;

// Validação do conteúdo baixado (T36). Sobrescrevível por chamada (`validation`) e, nos testes, por
// `setDefaultCatalogValidation` (fixtures pequenas).
const STRICT_VALIDATION = Object.freeze({
  minRows: CATALOG_MIN_ROWS, maxSkippedRatio: CATALOG_MAX_SKIPPED_RATIO, requireSkinShape: true,
});
let defaultValidation = STRICT_VALIDATION;

function setDefaultCatalogValidation(validation = null) {
  defaultValidation = validation ? { ...STRICT_VALIDATION, ...validation } : STRICT_VALIDATION;
}

let refreshInProgress = false;

function isCatalogRefreshInProgress() {
  return refreshInProgress;
}

const isNil = (v) => v === null || v === undefined;

// --- Visão pública ------------------------------------------------------------------------------

function toCatalogView(row) {
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    category: row.category,
    name: row.name,
    namePtBr: row.namePtBr,
    imageUrl: toSafeImageUrl(row.imageUrl),
    minFloat: row.minFloat,
    maxFloat: row.maxFloat,
    hasStattrak: row.hasStattrak,
    hasSouvenir: row.hasSouvenir,
    phase: row.phase,
    rarity: row.rarity,
  };
}

// --- Consulta -----------------------------------------------------------------------------------

function searchCatalog({ q, category, limit } = {}) {
  const normalized = normalizeSearchText(q);
  if (normalized.length < MIN_QUERY_LENGTH) {
    throw new ValidationError(`Digite ao menos ${MIN_QUERY_LENGTH} caracteres para buscar.`, 'INVALID_QUERY');
  }
  if (!isNil(category) && !CATEGORIES.includes(category)) {
    throw new ValidationError('Categoria inválida.', 'INVALID_QUERY');
  }
  const finalLimit = isNil(limit) ? CATALOG_SEARCH_DEFAULT_LIMIT : limit;
  if (!Number.isInteger(finalLimit) || finalLimit < 1 || finalLimit > CATALOG_SEARCH_MAX_LIMIT) {
    throw new ValidationError(`O limite deve ser um inteiro entre 1 e ${CATALOG_SEARCH_MAX_LIMIT}.`, 'INVALID_QUERY');
  }
  const { rows, total } = CatalogItem.search({
    tokens: normalized.split(' '),
    category: isNil(category) ? undefined : category,
    limit: finalLimit,
    dedupe: true, // D115
  });
  return { items: rows.map(toCatalogView), meta: { catalogUpdatedAt: Setting.get().catalogUpdatedAt, total } };
}

function getCatalogItem(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > CATALOG_ID_MAX_LENGTH) return null;
  return toCatalogView(CatalogItem.findById(id));
}

// Rota do catálogo: 404. (O itemService converte para 400 no corpo do item.)
function getCatalogItemOrFail(id) {
  const item = getCatalogItem(id);
  if (!item) throw new NotFoundError('Item do catálogo não encontrado.', 'CATALOG_ITEM_NOT_FOUND');
  return item;
}

function getCatalogItemsByIds(ids) {
  return CatalogItem.findByIds(ids.filter((id) => typeof id === 'string')).map(toCatalogView);
}

// Entrada de nome igual (normalizado) e categoria igual, ou `null` (D78, PASSE_BATALHA livre).
function findExactMatch({ name, category }) {
  const [first] = CatalogItem.findByNameKey(normalizeSearchText(name), category);
  return first ? toCatalogView(first) : null;
}

function getCatalogStatus() {
  const countsBySource = CatalogItem.countBySource();
  const total = Object.values(countsBySource).reduce((sum, n) => sum + n, 0);
  return { catalogUpdatedAt: Setting.get().catalogUpdatedAt, countsBySource, total };
}

// --- Download online ----------------------------------------------------------------------------

function urlFor(lang, file) {
  return `${CATALOG_BASE_URL}${lang}/${file}`;
}

function tooLarge() {
  return new UpstreamError('O catálogo baixado é grande demais.', 'CATALOG_INVALID_FORMAT');
}

// Lê o corpo respeitando o teto de bytes (T36): confere o content-length e conta os bytes do stream.
// Sem corpo legível como texto devolve null (o chamador tenta `json()`).
async function readLimitedText(response, maxBytes = CATALOG_MAX_FILE_BYTES) {
  const header = response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-length') : null;
  if (header !== null && header !== undefined && Number(header) > maxBytes) throw tooLarge();
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  if (typeof response.text !== 'function') return null;
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw tooLarge();
  return text;
}

async function fetchJson(fetchFn, url, { signal, optional }) {
  let response;
  let text;
  try {
    response = await fetchFn(url, { signal });
    // Idioma secundário não hospedado (404) é tolerado: o nome traduzido fica nulo (adendo D80).
    if (optional && response.status === 404) return null;
    if (!response.ok) {
      throw new UpstreamError(
        'Não foi possível baixar o catálogo. Verifique a conexão com a internet.',
        'CATALOG_FETCH_FAILED'
      );
    }
    text = await readLimitedText(response);
    if (text === null) return await response.json();
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    if (err instanceof SyntaxError) {
      throw new UpstreamError('O catálogo baixado está em um formato inválido.', 'CATALOG_INVALID_FORMAT');
    }
    throw new UpstreamError('Não foi possível baixar o catálogo. Verifique a conexão com a internet.', 'CATALOG_FETCH_FAILED');
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UpstreamError('O catálogo baixado está em um formato inválido.', 'CATALOG_INVALID_FORMAT');
  }
}

// Baixa os arquivos de todos os idiomas e mapeia. Tudo ou nada: qualquer falha lança e nada é gravado.
function invalidDownload(detail) {
  return new UpstreamError(`O catálogo baixado parece incompleto ou inválido (${detail}).`, 'CATALOG_INVALID_FORMAT');
}

// Valida o resultado do mapeamento do `en` antes de aceitar o refresh (tudo ou nada).
function validateDownloadedCatalog({ rows, skipped }, validation = defaultValidation) {
  const { minRows, maxSkippedRatio, requireSkinShape } = { ...STRICT_VALIDATION, ...validation };
  if (rows.length === 0) throw invalidDownload('nenhum item');
  const counts = Object.fromEntries(SOURCES.map((s) => [s, 0]));
  for (const row of rows) counts[row.source] += 1;
  for (const source of SOURCES) {
    const min = (minRows && minRows[source]) || 0;
    if (counts[source] < min) throw invalidDownload(`${source} tem ${counts[source]} itens, mínimo ${min}`);
  }
  const ratio = skipped / (rows.length + skipped);
  if (ratio > maxSkippedRatio) throw invalidDownload(`${skipped} entradas ignoradas`);
  if (requireSkinShape) {
    const skins = rows.filter((r) => r.source === 'SKINS');
    if (!skins.some((r) => r.category === 'FACA')) throw invalidDownload('SKINS sem facas');
    if (!skins.some((r) => r.category === 'LUVA')) throw invalidDownload('SKINS sem luvas');
    if (!skins.some((r) => r.minFloat !== null && r.maxFloat !== null)) throw invalidDownload('SKINS sem faixa de float');
  }
}

async function downloadCatalog({ fetchFn = globalThis.fetch, timeoutMs = CATALOG_FETCH_TIMEOUT_MS, validation } = {}) {
  if (typeof fetchFn !== 'function') {
    throw new UpstreamError('Não foi possível baixar o catálogo. Verifique a conexão com a internet.', 'CATALOG_FETCH_FAILED');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const jobs = [];
    for (const lang of CATALOG_LANGUAGES) {
      for (const source of SOURCES) {
        const optional = lang !== 'en';
        jobs.push(
          fetchJson(fetchFn, urlFor(lang, CATALOG_FILES[source]), { signal: controller.signal, optional }).then((json) => {
            if (json !== null && !Array.isArray(json)) {
              throw new UpstreamError('O catálogo baixado está em um formato inválido.', 'CATALOG_INVALID_FORMAT');
            }
            return { lang, source, json };
          })
        );
      }
    }
    let results;
    try {
      results = await Promise.all(jobs);
    } catch (err) {
      controller.abort();
      jobs.forEach((job) => job.catch(() => {}));
      throw err;
    }
    const data = { en: {}, 'pt-BR': {} };
    for (const { lang, source, json } of results) if (json !== null) data[lang][source] = json;
    const mapped = mapCatalog({ en: data.en, ptBr: data['pt-BR'] });
    validateDownloadedCatalog(mapped, validation || defaultValidation);
    // Fontes sem pt-BR (404): o refresh preserva as traduções já gravadas.
    return { ...mapped, ptBrMissing: SOURCES.filter((s) => !data['pt-BR'][s]) };
  } finally {
    clearTimeout(timer);
  }
}

// --- Gravação -----------------------------------------------------------------------------------

function writeCatalog(rows, { now, catalogUpdatedAt }) {
  runInTransaction(() => {
    CatalogItem.upsertMany(rows, { now });
    Setting.update({ catalogUpdatedAt }, { now });
  });
}

// Linhas de fontes sem pt-BR herdam a tradução gravada; o texto de busca é recalculado junto.
function keepStoredTranslations(rows, ptBrMissing) {
  const missing = rows.filter((r) => ptBrMissing.includes(r.source) && !r.namePtBr);
  if (missing.length === 0) return;
  const stored = new Map(CatalogItem.findByIds(missing.map((r) => r.id)).map((r) => [r.id, r.namePtBr]));
  for (const row of missing) {
    const namePtBr = stored.get(row.id);
    if (!namePtBr) continue;
    row.namePtBr = namePtBr;
    row.searchText = buildSearchText(row.nameKey, namePtBr);
  }
}

async function refreshCatalog({ fetchFn = globalThis.fetch, now = new Date(), timeoutMs, validation } = {}) {
  if (refreshInProgress) {
    throw new ConflictError('Já existe uma atualização do catálogo em andamento.', 'CATALOG_REFRESH_IN_PROGRESS');
  }
  refreshInProgress = true;
  try {
    const { rows, skipped, ptBrMissing } = await downloadCatalog({ fetchFn, timeoutMs, validation });
    keepStoredTranslations(rows, ptBrMissing);
    writeCatalog(rows, { now, catalogUpdatedAt: now.toISOString() });
    const linkedLegacyItems = linkLegacyItems({ now });
    return { ...getCatalogStatus(), skipped, linkedLegacyItems };
  } finally {
    refreshInProgress = false;
  }
}

// --- Snapshot embutido (D81) --------------------------------------------------------------------

function invalidSnapshot(detail) {
  return new UpstreamError(`Snapshot do catálogo inválido: ${detail}.`, 'CATALOG_INVALID_FORMAT');
}

function isStringOrNull(v) {
  return v === null || typeof v === 'string';
}

function validateSnapshotRow(row, index) {
  const where = `linha ${index}`;
  if (!Array.isArray(row) || row.length !== SNAPSHOT_COLUMNS.length) throw invalidSnapshot(`${where} com formato incorreto`);
  const [id, source, category, name, namePtBr, imageUrl, minFloat, maxFloat, hasStattrak, hasSouvenir, phase, rarity] = row;
  if (typeof id !== 'string' || id.length > CATALOG_ID_MAX_LENGTH || !ID_PATTERN.test(id)) throw invalidSnapshot(`${where} com id inválido`);
  if (!SOURCES.includes(source)) throw invalidSnapshot(`${where} com fonte inválida`);
  if (!CATEGORIES.includes(category)) throw invalidSnapshot(`${where} com categoria inválida`);
  if (typeof name !== 'string' || name.trim() === '') throw invalidSnapshot(`${where} sem nome`);
  if (!isStringOrNull(namePtBr) || !isStringOrNull(imageUrl) || !isStringOrNull(phase) || !isStringOrNull(rarity)) {
    throw invalidSnapshot(`${where} com texto inválido`);
  }
  for (const f of [minFloat, maxFloat]) {
    if (f !== null && (typeof f !== 'number' || !Number.isFinite(f) || f < 0 || f > 1)) throw invalidSnapshot(`${where} com float inválido`);
  }
  if (minFloat !== null && maxFloat !== null && minFloat > maxFloat) throw invalidSnapshot(`${where} com minFloat maior que maxFloat`);
  if (![0, 1].includes(hasStattrak) || ![0, 1].includes(hasSouvenir)) throw invalidSnapshot(`${where} com StatTrak/Souvenir inválido`);
}

// Valida e converte o snapshot (objeto ou texto JSON) em linhas prontas para gravar.
function parseSnapshot(json) {
  let data = json;
  if (typeof json === 'string') {
    try {
      data = JSON.parse(json.replace(/^\uFEFF/, ''));
    } catch (err) {
      throw invalidSnapshot('JSON malformado');
    }
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw invalidSnapshot('estrutura inesperada');
  if (data.formatVersion !== SNAPSHOT_FORMAT_VERSION) throw invalidSnapshot(`formatVersion ${data.formatVersion} não suportado`);
  if (!Array.isArray(data.columns) || data.columns.length !== SNAPSHOT_COLUMNS.length || data.columns.some((c, i) => c !== SNAPSHOT_COLUMNS[i])) {
    throw invalidSnapshot('colunas diferentes do esperado');
  }
  if (typeof data.generatedAt !== 'string' || Number.isNaN(Date.parse(data.generatedAt))) throw invalidSnapshot('generatedAt inválido');
  if (!Array.isArray(data.rows)) throw invalidSnapshot('rows ausente');

  const seen = new Set();
  const rows = data.rows.map((row, index) => {
    validateSnapshotRow(row, index);
    if (seen.has(row[0])) throw invalidSnapshot(`id repetido (${row[0]})`);
    seen.add(row[0]);
    const [id, source, category, name, namePtBr, imageUrl, minFloat, maxFloat, hasStattrak, hasSouvenir, phase, rarity] = row;
    const nameKey = normalizeSearchText(name);
    const ptKey = namePtBr ? normalizeSearchText(namePtBr) : '';
    return {
      id, source, category, name, namePtBr, nameKey,
      searchText: ptKey && ptKey !== nameKey ? `${nameKey} ${ptKey}` : nameKey,
      imageUrl: toSafeImageUrl(imageUrl), minFloat, maxFloat, hasStattrak, hasSouvenir, phase, rarity,
    };
  });
  return { generatedAt: data.generatedAt, rows };
}

// Texto do snapshot: JSON válido, uma linha de `rows` por linha do arquivo, ordenado por id.
function serializeSnapshot(rows, { now = new Date() } = {}) {
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const counts = Object.fromEntries(SOURCES.map((s) => [s, 0]));
  for (const row of sorted) counts[row.source] += 1;
  const header = {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    generatedAt: now.toISOString(),
    source: SNAPSHOT_SOURCE_URL,
    counts,
    columns: SNAPSHOT_COLUMNS,
  };
  const lines = sorted.map((r) =>
    JSON.stringify([
      r.id, r.source, r.category, r.name, r.namePtBr ?? null, r.imageUrl ?? null, r.minFloat ?? null, r.maxFloat ?? null,
      r.hasStattrak ? 1 : 0, r.hasSouvenir ? 1 : 0, r.phase ?? null, r.rarity ?? null,
    ])
  );
  const head = JSON.stringify(header);
  return `${head.slice(0, -1)},"rows":[\n${lines.join(',\n')}\n]}\n`;
}

// Importa um snapshot (objeto ou texto) sem consultar datas: upsert + `catalog_updated_at = generatedAt`.
function importSnapshot(snapshot, { now = new Date() } = {}) {
  const { generatedAt, rows } = parseSnapshot(snapshot);
  writeCatalog(rows, { now, catalogUpdatedAt: generatedAt });
  return { imported: rows.length, generatedAt };
}

// Importa o snapshot do projeto se for mais novo que a última atualização. Nunca lança (D81).
function syncBundledCatalog({ now = new Date(), snapshotPath = CATALOG_SNAPSHOT_PATH } = {}) {
  const result = { imported: 0, linkedLegacyItems: 0, error: null };
  try {
    const text = fs.readFileSync(snapshotPath, 'utf8');
    const parsed = parseSnapshot(text);
    const current = Setting.get().catalogUpdatedAt;
    if (current === null || Date.parse(current) < Date.parse(parsed.generatedAt)) {
      writeCatalog(parsed.rows, { now, catalogUpdatedAt: parsed.generatedAt });
      result.imported = parsed.rows.length;
    }
  } catch (err) {
    result.error = err;
    console.error(
      `Não foi possível importar o catálogo embutido (${path.basename(snapshotPath)}): ${err && err.message ? err.message : err}`
    );
  }
  result.linkedLegacyItems = linkLegacyItems({ now });
  return result;
}

// --- Itens legados (D82) ------------------------------------------------------------------------

// Função pura: devolve a única entrada do catálogo que casa com o item legado, ou `null`.
function matchLegacyItem(item, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const itemPhase = isNil(item.phase) ? null : normalizeSearchText(item.phase);
  let pool = candidates;
  if (pool.length > 1 && itemPhase !== null) {
    pool = pool.filter((c) => !isNil(c.phase) && normalizeSearchText(c.phase) === itemPhase);
  }
  if (pool.length !== 1) return null;
  const [candidate] = pool;
  if (!isNil(item.floatValue) && !isNil(candidate.minFloat) && !isNil(candidate.maxFloat)) {
    if (item.floatValue < candidate.minFloat || item.floatValue > candidate.maxFloat) return null;
  }
  if (!isNil(candidate.phase) && itemPhase !== null && normalizeSearchText(candidate.phase) !== itemPhase) return null;
  return candidate;
}

// Vincula legados ao catálogo (nome + categoria). Nunca lança; devolve a quantidade vinculada.
function linkLegacyItems({ now = new Date() } = {}) {
  try {
    return runInTransaction(() => {
      let linked = 0;
      for (const item of Item.findLegacy(CATALOG_CATEGORIES)) {
        const candidates = CatalogItem.findByNameKey(normalizeSearchText(item.name), item.category);
        const match = matchLegacyItem(item, candidates);
        if (!match) continue;
        const patch = { catalogId: match.id, name: match.name };
        if (!isNil(match.phase)) patch.phase = match.phase;
        Item.update(item.id, patch, { now });
        linked += 1;
      }
      return linked;
    });
  } catch (err) {
    console.error(`Não foi possível vincular itens antigos ao catálogo: ${err && err.message ? err.message : err}`);
    return 0;
  }
}

module.exports = {
  toCatalogView,
  searchCatalog,
  getCatalogItem,
  getCatalogItemOrFail,
  getCatalogItemsByIds,
  findExactMatch,
  getCatalogStatus,
  downloadCatalog,
  validateDownloadedCatalog,
  setDefaultCatalogValidation,
  refreshCatalog,
  isCatalogRefreshInProgress,
  parseSnapshot,
  serializeSnapshot,
  importSnapshot,
  syncBundledCatalog,
  matchLegacyItem,
  linkLegacyItems,
};
