'use strict';

const { parseDate } = require('./dateUtils');

const MIN_MS = 60000;

// "2d 14h 20min restantes", omitindo unidades zeradas à esquerda; nunca "0min" enquanto bloqueado.
function formatRemaining(remainingMs) {
  const totalMin = Math.max(1, Math.ceil(remainingMs / MIN_MS));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}min`);
  return `${parts.join(' ')} restantes`;
}

function getTradeLockStatus(tradeUnlockAt, now = new Date()) {
  const nowDate = parseDate(now, 'Data atual');
  if (tradeUnlockAt === null || tradeUnlockAt === undefined) {
    return { isLocked: false, remainingMs: 0, formatted: 'Liberado', tradeUnlockAt: null };
  }
  const unlock = parseDate(tradeUnlockAt, 'Data de liberação da troca');
  const remainingMs = unlock.getTime() - nowDate.getTime();
  if (remainingMs <= 0) {
    return { isLocked: false, remainingMs: 0, formatted: 'Liberado', tradeUnlockAt: unlock.toISOString() };
  }
  return { isLocked: true, remainingMs, formatted: formatRemaining(remainingMs), tradeUnlockAt: unlock.toISOString() };
}

module.exports = { getTradeLockStatus, formatRemaining };
