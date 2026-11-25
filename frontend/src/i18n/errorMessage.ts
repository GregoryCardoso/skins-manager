import { formatDate, formatDateTime, formatFloat, formatMoney } from '@/lib/format';
import { ApiRequestError } from '@/services/api';

type LooseT = (key: string, params?: Record<string, string | number>) => string;

// Nome de uma fonte de importação para as mensagens (D316).
const sourceDisplayName = (source: string) => (source === 'CSFLOAT' ? 'CSFloat' : source);

// Limite da faixa de cotação: inteiro ou até 4 casas, sem agrupar milhar em excesso (ex.: 0,5 e 100.000).
const formatRateBound = (value: number, locale: string) => new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value);

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
    case 'INVALID_SALE_HOLD_DAYS':
      return typeof p.min === 'number' && typeof p.max === 'number' ? { min: p.min, max: p.max } : null;
    case 'PAYLOAD_TOO_LARGE':
      return typeof p.maxBytes === 'number' ? { maxMb: Math.round(p.maxBytes / (1024 * 1024)) } : null;
    case 'BACKUP_NEWER_VERSION':
      return typeof p.fileVersion === 'number' && typeof p.appVersion === 'number'
        ? { fileVersion: p.fileVersion, appVersion: p.appVersion }
        : null;
    case 'FX_RATE_OUT_OF_RANGE':
      // A faixa aceita para a cotação digitada à mão (11.3): números pelo `Intl` do idioma, sem símbolo de moeda.
      return typeof p.currency === 'string' && typeof p.min === 'number' && typeof p.max === 'number'
        ? { currency: p.currency, min: formatRateBound(p.min, locale), max: formatRateBound(p.max, locale) }
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
    case 'IMPORT_SOURCE_UNREACHABLE':
    case 'IMPORT_SOURCE_UNAVAILABLE':
    case 'IMPORT_SOURCE_FORMAT_CHANGED':
      // `params.source` (CSFLOAT) vira o nome da loja na mensagem (D316).
      return typeof p.source === 'string' ? { source: sourceDisplayName(p.source) } : null;
    case 'IMPORT_RATE_LIMITED': {
      if (typeof p.source !== 'string' || typeof p.retryAt !== 'string') return null;
      const when = formatDateTime(p.retryAt, locale);
      return when ? { source: sourceDisplayName(p.source), retryAt: when } : null;
    }
    case 'COMPONENTS_NOT_ALLOWED':
    case 'COMPONENT_CATALOG_REQUIRED':
    case 'COMPONENT_CATALOG_MISMATCH':
    case 'INVALID_COMPONENT_FIELD':
      // `params.index` (base 0) aponta o componente; sem ele vale o texto geral.
      return typeof p.index === 'number' ? { n: p.index + 1 } : null;
    case 'CASE_KEY_REQUIRED':
      return typeof p.keyName === 'string' ? { keyName: p.keyName } : null;
    case 'CASE_KEY_INCOMPATIBLE':
      return typeof p.keyName === 'string' && typeof p.caseName === 'string' ? { keyName: p.keyName, caseName: p.caseName } : null;
    case 'GENERATED_FIELD_LOCKED': {
      if (!error.field) return null;
      const label = t(`fields.${error.field}`);
      return { field: label !== `fields.${error.field}` ? label : error.field };
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
// Erros com vários motivos (10.3, D362): o texto sai de `errors.<CÓDIGO>_<MOTIVO>`, com a data do limite quando vier.
const REASON_CODES = ['OPERATION_DATE_INVALID', 'OPERATION_UNDO_BLOCKED', 'INVALID_OPERATION_INPUT'];

function reasonMessage(error: ApiRequestError, t: LooseT, locale: string): string | null {
  const p = error.params ?? {};
  if (!REASON_CODES.includes(error.code) || typeof p.reason !== 'string') return null;
  const limit = [p.soldAt, p.acquiredAt, p.occurredAt].find((value) => typeof value === 'string');
  const key = `errorReasons.${error.code}_${p.reason}`;
  const text = t(key, { date: typeof limit === 'string' ? formatDate(limit, locale) : '' });
  return text !== key ? text : null;
}

export function errorMessageFor(error: unknown, t: LooseT, locale = 'en'): string {
  if (error instanceof ApiRequestError) {
    const byReason = reasonMessage(error, t, locale);
    if (byReason) return byReason;
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
