'use strict';

// Cor de fundo da janela antes de a página pintar (12.10), para não piscar branco no tema escuro.
// Iguais ao --bg de frontend/src/styles/tokens.css (preso por teste).
const BACKGROUND_LIGHT = '#eef4f3';
const BACKGROUND_DARK = '#0e1f22';

// theme: LIGHT | DARK | SYSTEM como nas configurações (maiúsculas ou minúsculas; nulo/desconhecido = segue o sistema).
function backgroundFor({ theme, systemDark = false } = {}) {
  const normalized = typeof theme === 'string' ? theme.toLowerCase() : '';
  if (normalized === 'dark') return BACKGROUND_DARK;
  if (normalized === 'light') return BACKGROUND_LIGHT;
  return systemDark ? BACKGROUND_DARK : BACKGROUND_LIGHT;
}

module.exports = { backgroundFor, BACKGROUND_LIGHT, BACKGROUND_DARK };
