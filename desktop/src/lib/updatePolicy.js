'use strict';

// Política de atualização (D181), pura e testável: semver com pré-release, decisão a partir do JSON de
// `releases/latest` do GitHub e validação da URL da página da release.
const REPO_OWNER = 'GregoryCardoso';
const REPO_NAME = 'skins-manager';
const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const RELEASE_BY_TAG_API_PREFIX = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/`;
const RELEASE_URL_PREFIX = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/`;
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 10 * 1000;

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(text) {
  if (typeof text !== 'string') return null;
  const match = SEMVER_RE.exec(text.trim());
  if (!match) return null;
  const nums = [match[1], match[2], match[3]].map(Number);
  if (!nums.every((n) => Number.isSafeInteger(n))) return null;
  return { major: nums[0], minor: nums[1], patch: nums[2], prerelease: match[4] ? match[4].split('.') : [] };
}

function comparePrereleaseId(a, b) {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return Math.sign(Number(a) - Number(b));
  if (aNum) return -1; // numérico < alfanumérico
  if (bNum) return 1;
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// -1, 0 ou 1; null se alguma das versões for inválida. Versão com pré-release é menor que a final.
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;
  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i += 1) {
    if (pa.prerelease[i] === undefined) return -1;
    if (pb.prerelease[i] === undefined) return 1;
    const c = comparePrereleaseId(pa.prerelease[i], pb.prerelease[i]);
    if (c !== 0) return c;
  }
  return 0;
}

function isValidReleaseUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(RELEASE_URL_PREFIX)) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname === 'github.com' &&
    parsed.port === '' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.pathname.startsWith(`/${REPO_OWNER}/${REPO_NAME}/releases/`) &&
    !parsed.pathname.includes('..')
  );
}

// Decide a partir do JSON de `releases/latest`. Retorna:
//   { status: 'invalid' } | { status: 'up-to-date' | 'older-remote', latestVersion }
//   | { status: 'available', latestVersion, url, notes }
// Rascunho e pré-release nunca são oferecidos.
function evaluateLatestRelease(json, currentVersion) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { status: 'invalid' };
  if (json.draft === true || json.prerelease === true) return { status: 'invalid' };
  const latestVersion = typeof json.tag_name === 'string' ? json.tag_name.trim().replace(/^v/, '') : '';
  const cmp = compareVersions(latestVersion, currentVersion);
  if (cmp === null) return { status: 'invalid' };
  if (cmp === 0) return { status: 'up-to-date', latestVersion };
  if (cmp < 0) return { status: 'older-remote', latestVersion };
  if (!isValidReleaseUrl(json.html_url)) return { status: 'invalid' };
  return {
    status: 'available',
    latestVersion,
    url: json.html_url,
    notes: typeof json.body === 'string' ? json.body : '',
  };
}

const MAX_NOTES_CHARS = 20000;

// Corta as notas em `max` caracteres, no último fim de linha antes do limite, e acrescenta "…" (D191).
function limitReleaseNotes(text, max = MAX_NOTES_CHARS) {
  if (typeof text !== 'string') return '';
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastBreak = cut.lastIndexOf('\n');
  return `${(lastBreak > 0 ? cut.slice(0, lastBreak) : cut).trimEnd()}…`;
}

// URL da API para as notas de uma versão (D191). Versão inválida não monta URL (devolve null).
function releaseByTagApiUrl(version) {
  if (!parseVersion(version)) return null;
  return `${RELEASE_BY_TAG_API_PREFIX}${encodeURIComponent(`v${version.trim().replace(/^v/, '')}`)}`;
}

// Corpo (markdown) da release devolvida por `releases/tags/v<versão>`; null se algo não bater (D191).
function extractReleaseBody(json, version) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  if (typeof version !== 'string' || !parseVersion(version)) return null;
  if (json.tag_name !== `v${version}`) return null;
  if (json.draft === true || json.prerelease === true) return null;
  return typeof json.body === 'string' ? json.body : null;
}

// Reserva (D191): notas do feed do electron-updater (HTML ou lista) viram texto puro, sem marcadores de
// idioma (os comentários HTML saem junto com as tags), e limitadas a 20 000 caracteres.
function formatReleaseNotes(notes) {
  let text = '';
  if (typeof notes === 'string') text = notes;
  else if (Array.isArray(notes)) {
    text = notes
      .map((entry) => (entry && typeof entry.note === 'string' ? entry.note : ''))
      .filter(Boolean)
      .join('\n\n');
  }
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    // entidades comuns do HTML do feed; o resultado é texto (o renderizador do modal não interpreta HTML)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return limitReleaseNotes(text);
}

module.exports = {
  LATEST_RELEASE_API_URL,
  RELEASE_URL_PREFIX,
  MAX_NOTES_CHARS,
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  parseVersion,
  compareVersions,
  isValidReleaseUrl,
  evaluateLatestRelease,
  formatReleaseNotes,
  limitReleaseNotes,
  releaseByTagApiUrl,
  extractReleaseBody,
};
