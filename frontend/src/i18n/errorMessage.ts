import { formatDate, formatFloat, formatMoney } from '@/lib/format';
import { ApiRequestError } from '@/services/api';

type LooseT = (key: string, params?: Record<string, string | number>) => string;

// Valores do backend (`error.params`) já formatados para interpolar na mensagem, por código (D120).
// Devolve null quando o código não tem texto detalhado ou faltam os valores necessários.
export function errorDetailParams(
  error: ApiRequestError,
  t: LooseT,
  locale: string,
): Record<string, string | number> | null {
  const p = error.params ?? {};
  switch (error.code) {
    case 'ITEM_TRADE_LOCKED':
      return typeof p.tradeUnlockAt === 'string' ? { date: formatDate(p.tradeUnlockAt, locale) } : null;
    case 'FLOAT_OUT_OF_RANGE':
      return typeof p.minFloat === 'number' && typeof p.maxFloat === 'number'
        ? { min: formatFloat(p.minFloat, locale), max: formatFloat(p.maxFloat, locale) }
        : null;
    case 'FIELD_TOO_LONG':
      return typeof p.maxLength === 'number' ? { max: p.maxLength } : null;
    case 'INVALID_AMOUNT':
      // Só o teto tem texto detalhado; a moeda é desconhecida aqui, então o valor sai sem símbolo.
      return typeof p.maxCents === 'number'
        ? { max: formatMoney(p.maxCents, 'USD', locale).replace(/[^\d.,\s]/g, '').trim() }
        : null;
    case 'AGING_THRESHOLDS_ORDER':
      return typeof p.fastTurnoverDays === 'number' && typeof p.slowItemDays === 'number'
        ? { fast: p.fastTurnoverDays, slow: p.slowItemDays }
        : null;
    case 'INVALID_RATE':
      // O backend envia as casas da fração (6); no formulário o percentual tem 2 a menos (4).
      return typeof p.maxDecimals === 'number' ? { maxDecimals: Math.max(0, p.maxDecimals - 2) } : null;
    case 'PAYLOAD_TOO_LARGE':
      return typeof p.maxBytes === 'number' ? { maxMb: Math.round(p.maxBytes / (1024 * 1024)) } : null;
    case 'BACKUP_NEWER_VERSION':
      return typeof p.fileVersion === 'number' && typeof p.appVersion === 'number'
        ? { fileVersion: p.fileVersion, appVersion: p.appVersion }
        : null;
    case 'FX_FETCH_FAILED':
    case 'FX_RATE_LIMITED':
    case 'FX_INVALID_RESPONSE':
    case 'FX_REFRESH_IN_PROGRESS':
    case 'PTAX_NOT_FOUND': {
      // `params.source` (AWESOMEAPI | PTAX) vira o nome da fonte na mensagem (D162).
      if (typeof p.source !== 'string') return null;
      const key = `fx.sourceName.${p.source}`;
      const name = t(key);
      return { source: name !== key ? name : p.source };
    }
    case 'UNKNOWN_FIELD': {
      if (!error.field) return null;
      const label = t(`fields.${error.field}`);
      return { field: label !== `fields.${error.field}` ? label : error.field };
    }
    default:
      return null;
  }
}

// Código conhecido -> texto traduzido (com detalhes quando vierem `params`/`field`); senão a mensagem do backend;
// senão "erro desconhecido".
export function errorMessageFor(error: unknown, t: LooseT, locale = 'pt-BR'): string {
  if (error instanceof ApiRequestError) {
    const detailParams = errorDetailParams(error, t, locale);
    if (detailParams) {
      const detailKey = `errorDetails.${error.code}`;
      const detailed = t(detailKey, detailParams);
      if (detailed !== detailKey) return detailed;
    }
    const key = `errors.${error.code}`;
    const translated = t(key);
    if (translated !== key) return translated;
    if (error.message.trim() !== '') return error.message;
  }
  return t('errors.UNKNOWN');
}
