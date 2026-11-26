'use strict';

// Tamanho inicial da janela (12.10): o preferido, limitado à área útil da tela e nunca abaixo do mínimo.
const PREFERRED = Object.freeze({ width: 1280, height: 800 });
const MIN = Object.freeze({ width: 800, height: 600 });

function clamp(preferred, available, min) {
  const limit = Number.isFinite(available) && available > 0 ? Math.min(preferred, Math.floor(available)) : preferred;
  return Math.max(min, limit);
}

// workArea: { width, height } da área útil do monitor (sem a barra de tarefas); pode faltar.
function computeInitialBounds({ workArea = null, preferred = PREFERRED, min = MIN } = {}) {
  return {
    width: clamp(preferred.width, workArea && workArea.width, min.width),
    height: clamp(preferred.height, workArea && workArea.height, min.height),
  };
}

module.exports = { computeInitialBounds, PREFERRED, MIN };
