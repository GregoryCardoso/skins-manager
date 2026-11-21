// Constantes compartilhadas entre config e services (T14). Arquivo sem dependências além de `path`.
const path = require('path');

// Limites de giro (D159): 1 <= rápido < agarrado <= 365. O mínimo do agarrado (2) é o mínimo do rápido + 1.
const DEFAULT_FAST_TURNOVER_DAYS = 7;
const MIN_FAST_TURNOVER_DAYS = 1;
const MAX_FAST_TURNOVER_DAYS = 364;
const MIN_SLOW_ITEM_DAYS = 2;
const MAX_SLOW_ITEM_DAYS = 365;
// Teto de qualquer valor em centavos recebido pela API (R$/US$ 100 milhões).
const MAX_AMOUNT_CENTS = 1e10;
// Limites de texto (após trim).
const MAX_NAME_LENGTH = 200;
const MAX_ORIGIN_DETAIL_LENGTH = 200;
const MAX_INSPECT_LINK_LENGTH = 2048; // T30 (D114)
const MAX_ASSET_ID_LENGTH = 64;
const MAX_PHASE_LENGTH = 100;
const MAX_STORE_NAME_LENGTH = 50; // D145
// Casas decimais máximas das taxas percentuais de loja (0.025 = 2,5%); a tela usa % com até 4 casas.
const RATE_MAX_DECIMALS = 6;
// Retenção do saldo após a venda, em dias (D213): 0 = disponível na hora.
const MAX_SALE_HOLD_DAYS = 30;
const MAX_NOTE_LENGTH = 500; // note de deposits e withdrawals (Etapa 8); validada no depositService e, na 8.2, no withdrawalService

// Catálogo de itens (D70, D80, D81).
// Adendo D80: o GitHub Pages antigo (bymykel.github.io) redireciona para um 404; a API hospedada vive no raw do GitHub.
const CATALOG_BASE_URL = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/';
const CATALOG_LANGUAGES = Object.freeze(['en', 'pt-BR']);
const CATALOG_FILES = Object.freeze({
  SKINS: 'skins.json',
  STICKERS: 'stickers.json',
  CRATES: 'crates.json',
  KEYCHAINS: 'keychains.json',
  AGENTS: 'agents.json',
});
const CATALOG_FETCH_TIMEOUT_MS = 120000;
// Teto por arquivo baixado (T36): os maiores têm poucos MB; 50 MB protege contra resposta descontrolada.
const CATALOG_MAX_FILE_BYTES = 50 * 1024 * 1024;
const CATALOG_SEARCH_DEFAULT_LIMIT = 20;
const CATALOG_SEARCH_MAX_LIMIT = 50;
const CATALOG_ID_MAX_LENGTH = 100;
// Validação do conteúdo baixado (T36): mínimos conservadores por fonte (snapshot real: 2246/11907/485/78/63).
const CATALOG_MIN_ROWS = Object.freeze({ SKINS: 1000, STICKERS: 1000, CRATES: 100, KEYCHAINS: 10, AGENTS: 10 });
const CATALOG_MAX_SKIPPED_RATIO = 0.1;
const CATALOG_SNAPSHOT_PATH = path.join(__dirname, '..', '..', 'data', 'seed', 'catalog.json');

// Preferências pessoais (D83). 'SYSTEM' (padrão da migração v2) significa "sem preferência" (D112):
// a interface só oferece LIGHT/DARK e usa o tema do sistema operacional como valor inicial.
// Continua aceito por compatibilidade com bancos que já o têm salvo; nenhuma migração é necessária.
const THEMES = Object.freeze(['SYSTEM', 'LIGHT', 'DARK']);
const LANGUAGES = Object.freeze(['pt-BR', 'en']);

// PTAX do Banco Central (D147).
const PTAX_BASE_URL = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)';
const PTAX_CALL_TIMEOUT_MS = 10000;
const PTAX_TOTAL_TIMEOUT_MS = 20000;
const PTAX_MAX_LOOKBACK_DAYS = 7;

// Fontes da cotação USD→BRL (D162): limites comuns, AwesomeAPI e valores aceitos nas colunas.
const FX_MIN_RATE = 1;
const FX_MAX_RATE = 50;
const FX_MAX_RESPONSE_BYTES = 64 * 1024;
const AWESOMEAPI_URL = 'https://economia.awesomeapi.com.br/json/last/USD-BRL';
const AWESOMEAPI_TIMEOUT_MS = 10000;
const FX_REFRESH_SOURCES = Object.freeze(['AWESOMEAPI', 'PTAX']); // fx_refresh_source
const FX_RATE_SOURCES = Object.freeze(['MANUAL', 'PTAX', 'AWESOMEAPI']); // usd_brl_rate_source

// Backup (D150, D151).
const BACKUP_MAX_BYTES = 100 * 1024 * 1024;
const { AUTO_BACKUP_KEEP } = require('./backupRetention'); // retenção dos backups automáticos (D151)
const SQLITE_APPLICATION_ID = 1397444935; // 'SKMG' (v4, D143)

module.exports = Object.freeze({
  BACKUP_MAX_BYTES,
  AUTO_BACKUP_KEEP,
  SQLITE_APPLICATION_ID,
  DEFAULT_FAST_TURNOVER_DAYS,
  MIN_FAST_TURNOVER_DAYS,
  MAX_FAST_TURNOVER_DAYS,
  MIN_SLOW_ITEM_DAYS,
  MAX_SLOW_ITEM_DAYS,
  PTAX_BASE_URL,
  PTAX_CALL_TIMEOUT_MS,
  PTAX_TOTAL_TIMEOUT_MS,
  PTAX_MAX_LOOKBACK_DAYS,
  FX_MIN_RATE,
  FX_MAX_RATE,
  FX_MAX_RESPONSE_BYTES,
  AWESOMEAPI_URL,
  AWESOMEAPI_TIMEOUT_MS,
  FX_REFRESH_SOURCES,
  FX_RATE_SOURCES,
  MAX_AMOUNT_CENTS,
  MAX_NAME_LENGTH,
  MAX_ORIGIN_DETAIL_LENGTH,
  MAX_INSPECT_LINK_LENGTH,
  MAX_ASSET_ID_LENGTH,
  MAX_PHASE_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_STORE_NAME_LENGTH,
  MAX_SALE_HOLD_DAYS,
  RATE_MAX_DECIMALS,
  CATALOG_BASE_URL,
  CATALOG_LANGUAGES,
  CATALOG_FILES,
  CATALOG_FETCH_TIMEOUT_MS,
  CATALOG_MAX_FILE_BYTES,
  CATALOG_SEARCH_DEFAULT_LIMIT,
  CATALOG_SEARCH_MAX_LIMIT,
  CATALOG_ID_MAX_LENGTH,
  CATALOG_MIN_ROWS,
  CATALOG_MAX_SKIPPED_RATIO,
  CATALOG_SNAPSHOT_PATH,
  THEMES,
  LANGUAGES,
});
