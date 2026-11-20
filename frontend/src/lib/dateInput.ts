// Conversão entre o valor de <input type="datetime-local"> ("2026-11-20T14:30", hora local) e ISO 8601 (D7, D116).
// O ISO enviado carrega o offset local ("...-03:00"); o backend grava em UTC.

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const pad = (n: number, size = 2) => String(n).padStart(size, '0');

// Date -> "YYYY-MM-DDTHH:mm" na hora local.
export function dateToLocalInput(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ISO (qualquer fuso) -> valor do input na hora local. Vazio/inválido -> ''.
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : dateToLocalInput(date);
}

// Valor do input -> Date local. Vazio/inválido -> null.
export function localInputToDate(text: string): Date | null {
  const m = LOCAL_PATTERN.exec(text.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  // Recusa datas impossíveis ("2026-02-30" viraria março).
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  if (date.getHours() !== hour || date.getMinutes() !== minute) return null;
  return date;
}

// Valor do input -> ISO com offset local ("2026-11-20T14:30:00-03:00"). Vazio/inválido -> null.
export function localInputToIso(text: string): string | null {
  const date = localInputToDate(text);
  if (!date) return null;
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${dateToLocalInput(date)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// "Agora" no formato do input (precisão de minutos, nunca depois de `now`).
export function nowLocalInput(now: Date = new Date()): string {
  return dateToLocalInput(now);
}

// Soma dias corridos ao valor do input (usado em "+7 dias"). Base vazia/inválida -> a partir de `now`.
export function addDaysToLocalInput(text: string, days: number, now: Date = new Date()): string {
  const base = localInputToDate(text) ?? now;
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, base.getHours(), base.getMinutes());
  return dateToLocalInput(next);
}
