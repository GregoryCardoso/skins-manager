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
  // Linhas da loja Steam (11.4). Na 11.3 não há nenhuma: a Steam sempre fica como está ('KEEP').
  steamLines: readonly SteamLine[];
  // Escolha enviada ao backend. Na 11.3, sempre 'KEEP'.
  steamStore: SteamStoreChoice;
}

// Reservado para a 11.4: "A loja Steam também passa a usar <moeda>" (marcada), a explicação da Steam com lançamentos e a opção
// "Criar uma nova loja Steam em <moeda>" (desmarcada). Cada linha terá a chave de texto e o valor padrão da escolha.
export interface SteamLine {
  kind: 'FOLLOW' | 'LOCKED_INFO' | 'NEW_STORE';
  defaultChecked: boolean;
}

export function currencyChangeView(preview: CurrencyChangePreview | null, currency: string): CurrencyChangeView {
  const toBase = currency === 'USD';
  let noRate: CurrencyNoRate = 'NONE';
  if (preview && !toBase && !preview.fxRateAvailable) noRate = preview.automaticSource ? 'AUTO' : 'MANUAL';
  return { toBase, noRate, fetchRateAfter: noRate === 'AUTO', steamLines: [], steamStore: 'KEEP' };
}
