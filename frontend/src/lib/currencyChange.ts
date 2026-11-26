// O que o modal da troca da moeda de conversão mostra (D369 A4/A5, E-P3-Q18/Q19): puro e testável. A pré-visualização vem do backend
// (`GET /settings/currency-change-preview`); aqui só se escolhe o texto.
import type { CurrencyChangePreview, SteamStoreChoice } from '@/types/api';

export type CurrencyNoRate = 'NONE' | 'AUTO' | 'MANUAL';

export interface CurrencyChangeView {
  // A moeda nova é USD: os "≈" somem e nada é convertido.
  toBase: boolean;
  // Sem cotação gravada da moeda nova: o aviso depende de haver ou não fonte automática (a escolha é aceita do mesmo jeito).
  noRate: CurrencyNoRate;
  // O app busca a cotação logo depois de gravar (só quando falta e há fonte automática).
  fetchRateAfter: boolean;
  // Linhas da loja Steam (11.4, D369 A4), na ordem em que aparecem; vazio = nada a perguntar (sem loja Steam ou já na moeda nova).
  steamLines: readonly SteamLine[];
  // Moeda atual da loja Steam (para o texto "continua em <moeda antiga>"); nulo sem linhas.
  steamCurrency: string | null;
  // A Steam muda de moeda (FOLLOW ou NEW_STORE), tem taxa fixa/mínima e falta a cotação da moeda de origem ou da de destino: elas ficam
  // zeradas (aviso discreto, M1/M2 da 11.11). A decisão vem pronta do backend (`feesWillReset`); o modal só exibe, com uma das caixas marcada.
  steamFeesZeroed: boolean;
  // Moeda sem cotação citada no aviso (a nova, ou a atual da Steam); nulo sem aviso.
  steamFeesMissingCurrency: string | null;
}

// Linhas da loja Steam no modal:
// - FOLLOW: "A loja Steam também passa a usar <moeda>", marcada por padrão (Steam sem lançamentos);
// - LOCKED_INFO: só texto, "Sua loja Steam tem lançamentos em <moeda antiga>, que não podem ser convertidos. Ela continua em <moeda antiga>.";
// - NEW_STORE: "Criar uma nova loja Steam em <moeda>", desmarcada por padrão (Steam com lançamentos).
export interface SteamLine {
  kind: 'FOLLOW' | 'LOCKED_INFO' | 'NEW_STORE';
  // Só FOLLOW e NEW_STORE têm caixa de seleção; LOCKED_INFO é só texto.
  checkable: boolean;
  defaultChecked: boolean;
}

export function currencyChangeView(preview: CurrencyChangePreview | null, currency: string): CurrencyChangeView {
  const toBase = currency === 'USD';
  let noRate: CurrencyNoRate = 'NONE';
  if (preview && !toBase && !preview.fxRateAvailable) noRate = preview.automaticSource ? 'AUTO' : 'MANUAL';
  const steam = preview?.steamStore ?? null;
  let steamLines: SteamLine[] = [];
  if (steam && steam.currency !== currency) {
    steamLines = steam.hasEntries
      ? [
        { kind: 'LOCKED_INFO', checkable: false, defaultChecked: false },
        { kind: 'NEW_STORE', checkable: true, defaultChecked: false },
      ]
      : [{ kind: 'FOLLOW', checkable: true, defaultChecked: true }];
  }
  const steamFeesZeroed = steamLines.length > 0 && steam?.feesWillReset === true;
  return {
    toBase, noRate, fetchRateAfter: noRate === 'AUTO', steamLines, steamCurrency: steamLines.length > 0 && steam ? steam.currency : null, steamFeesZeroed,
    steamFeesMissingCurrency: steamFeesZeroed ? steam?.missingRateCurrency ?? currency : null,
  };
}

// Escolha enviada ao backend a partir das caixas marcadas: FOLLOW marcada = 'FOLLOW'; NEW_STORE marcada = 'NEW_STORE'; senão 'KEEP'.
export function steamChoiceFor(view: CurrencyChangeView, checked: Readonly<Record<string, boolean>>): SteamStoreChoice {
  for (const line of view.steamLines) {
    if (line.checkable && checked[line.kind] === true) return line.kind === 'FOLLOW' ? 'FOLLOW' : 'NEW_STORE';
  }
  return 'KEEP';
}

// Estado inicial das caixas (as marcadas por padrão).
export function initialSteamChecks(view: CurrencyChangeView): Record<string, boolean> {
  return Object.fromEntries(view.steamLines.filter((line) => line.checkable).map((line) => [line.kind, line.defaultChecked]));
}
