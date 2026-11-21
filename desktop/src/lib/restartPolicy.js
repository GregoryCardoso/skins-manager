'use strict';

// Política de reinício do backend (D178): até 3 reinícios em 5 minutos, esperas de 1 s, 3 s e 9 s.
const MAX_RESTARTS = 3;
const WINDOW_MS = 5 * 60 * 1000;
const DELAYS_MS = Object.freeze([1000, 3000, 9000]);

// Mantém só as quedas dentro da janela (as mais antigas não contam mais).
function pruneCrashes(crashTimes, now, windowMs = WINDOW_MS) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  return crashTimes.filter((time) => nowMs - time < windowMs);
}

// `crashTimes`: instantes (ms) das quedas, incluindo a que acabou de acontecer. Pura.
// -> { action: 'restart', delayMs, attempt } | { action: 'give-up', crashes }
function nextAction({ crashTimes, now, maxRestarts = MAX_RESTARTS, windowMs = WINDOW_MS, delaysMs = DELAYS_MS }) {
  const recent = pruneCrashes(crashTimes, now, windowMs);
  if (recent.length > maxRestarts) return { action: 'give-up', crashes: recent.length };
  const index = Math.max(0, Math.min(recent.length - 1, delaysMs.length - 1));
  return { action: 'restart', delayMs: delaysMs[index], attempt: Math.max(1, recent.length) };
}

module.exports = { nextAction, pruneCrashes, MAX_RESTARTS, WINDOW_MS, DELAYS_MS };
