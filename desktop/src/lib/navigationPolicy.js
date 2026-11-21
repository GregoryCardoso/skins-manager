'use strict';

// Política de navegação da janela (D179). Pura: decide o que fazer com uma URL.
//   'allow'    -> mesma origem do app
//   'external' -> abrir no navegador/sistema (shell.openExternal): https:// e steam://rungame/730
//   'block'    -> o resto (file:, javascript:, http: externo, outras origens...)

function parse(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    return new URL(value.trim());
  } catch (err) {
    return null;
  }
}

// Botão "Inspecionar" (mesma regra de safeUrl, D114): só o jogo 730 (CS2) pelo esquema steam.
function isSteamGameLink(url) {
  return url.protocol === 'steam:' && url.hostname.toLowerCase() === 'rungame' && /^\/730(\/|$)/.test(url.pathname);
}

function isSameOrigin(value, appOrigin) {
  const url = parse(value);
  const app = parse(appOrigin);
  if (!url || !app || url.origin === 'null') return false;
  return url.origin === app.origin;
}

function classify(value, appOrigin) {
  const url = parse(value);
  if (!url) return 'block';
  if (isSameOrigin(value, appOrigin)) return 'allow';
  if (url.protocol === 'https:' && url.hostname !== '') return 'external';
  if (isSteamGameLink(url)) return 'external';
  return 'block';
}

module.exports = { classify, isSameOrigin, isSteamGameLink };
