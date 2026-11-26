'use strict';

// Política das telas dentro da janela (12.10, parte 2): quem pode falar nos canais `desktop:screen*` e quais botões valem.
const { pathToFileURL } = require('url');

// Todos os ids de botão que o app sabe tratar; qualquer outro é recusado, mesmo que venha no estado.
const ALLOWED_BUTTON_IDS = Object.freeze(['retry', 'open-data', 'open-logs', 'open-browser', 'close']);

function normalizeFileUrl(value) {
  if (typeof value !== 'string' || value === '') return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch (err) {
    return null;
  }
  if (parsed.protocol !== 'file:') return null;
  if (parsed.search !== '' || parsed.username !== '' || parsed.password !== '') return null;
  if (parsed.host !== '') return null; // nada de compartilhamento de rede (file://servidor/...)
  // O Windows não diferencia maiúsculas de minúsculas no caminho (letra do disco, pasta).
  try {
    return decodeURIComponent(parsed.pathname).toLowerCase();
  } catch (err) {
    return null;
  }
}

// O remetente é exatamente a página de carregamento local (arquivo), e não a origem http do app nem outro arquivo.
// `loadingFile` pode ser a URL file: ou o caminho do arquivo.
function isScreenSender(senderUrl, loadingFile) {
  const expectedUrl = typeof loadingFile === 'string' && !loadingFile.startsWith('file:') ? pathToFileURL(loadingFile).href : loadingFile;
  const sender = normalizeFileUrl(senderUrl);
  const expected = normalizeFileUrl(expectedUrl);
  return sender !== null && expected !== null && sender === expected;
}

// O id precisa ser um botão do estado atual E estar na lista fixa.
function isAllowedChoice(state, id) {
  if (!state || !Array.isArray(state.buttons) || typeof id !== 'string') return false;
  if (!ALLOWED_BUTTON_IDS.includes(id)) return false;
  return state.buttons.some((button) => button && button.id === id);
}

// Lê só `{ id }` do que veio do renderer (campos extras são descartados).
function parseChoicePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return typeof payload.id === 'string' ? payload.id : null;
}

module.exports = { ALLOWED_BUTTON_IDS, isScreenSender, isAllowedChoice, parseChoicePayload };
