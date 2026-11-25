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
const MAX_NOTE_LENGTH = 500; // note de deposits e withdrawals (Etapa 8); validada no depositService e no withdrawalService

// Catálogo de itens (D70, D80, D81).
// Adendo D80: o GitHub Pages antigo (bymykel.github.io) redireciona para um 404; a API hospedada vive no raw do GitHub.
const CATALOG_BASE_URL = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/';
// Idioma do app -> pasta da CSGO-API (D369, 11.5). Verificado em 2026-11-25 (README e listagem do repositório): a API HOSPEDADA
// serve só `en` e `zh-CN` (completos: 100% dos ids de skins, stickers, crates, chaveiros, agentes e patches). `pt-BR`, `es-MX`, `ru`,
// `tr`, `fr`, `it`, `de`, `pl`, `uk`, `ja` e `ko` existem só como idiomas "disponíveis" para quem hospeda a própria cópia (404 hoje).
// Pasta ausente (404) é tolerada: o nome fica em inglês (ou o já gravado é preservado) e, quando a pasta passar a existir, o próximo
// refresh traz os nomes sem mudar o código. O espanhol usa `es-MX` (E-P3-Q7).
const CATALOG_LANGUAGE_FOLDERS = Object.freeze({
  en: 'en',
  'pt-BR': 'pt-BR',
  es: 'es-MX',
  ru: 'ru',
  tr: 'tr',
  fr: 'fr',
  it: 'it',
  'zh-CN': 'zh-CN',
  de: 'de',
  pl: 'pl',
  uk: 'uk',
  ja: 'ja',
  ko: 'ko',
});
const CATALOG_LANGUAGES = Object.freeze(Object.keys(CATALOG_LANGUAGE_FOLDERS));
const CATALOG_FILES = Object.freeze({
  SKINS: 'skins.json',
  STICKERS: 'stickers.json',
  CRATES: 'crates.json',
  KEYCHAINS: 'keychains.json',
  AGENTS: 'agents.json',
  PATCHES: 'patches.json',
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
// Idiomas aceitos (D369, 11.1): o inglês é o idioma base. O banco só confere o formato (v023); a lista fica aqui, e acrescentar
// um idioma é uma entrada nesta lista (mais o registro do frontend e o desktop), sem migração.
const LANGUAGES = Object.freeze(['en', 'pt-BR', 'es', 'fr', 'it', 'de']);
// Visão do inventário (D276): padrão 'GROUPED' (coluna NOT NULL com DEFAULT no banco).
const INVENTORY_VIEWS = Object.freeze(['INDIVIDUAL', 'GROUPED']);

// PTAX do Banco Central (D147).
const PTAX_BASE_URL = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)';
const PTAX_CALL_TIMEOUT_MS = 25000;
const PTAX_TOTAL_TIMEOUT_MS = 50000;
const PTAX_MAX_LOOKBACK_DAYS = 7;

// Fontes da cotação USD→BRL (D162): limites comuns, AwesomeAPI e valores aceitos nas colunas.
const FX_MIN_RATE = 1;
const FX_MAX_RATE = 50;
const FX_MAX_RESPONSE_BYTES = 64 * 1024;
const AWESOMEAPI_URL = 'https://economia.awesomeapi.com.br/json/last/USD-BRL';
const AWESOMEAPI_LAST_URL_PREFIX = 'https://economia.awesomeapi.com.br/json/last/USD-'; // + código da moeda (11.2)
const AWESOMEAPI_TIMEOUT_MS = 25000;
const FX_REFRESH_SOURCES = Object.freeze(['AWESOMEAPI', 'PTAX']); // fx_refresh_source
const FX_RATE_SOURCES = Object.freeze(['MANUAL', 'PTAX', 'AWESOMEAPI']); // usd_brl_rate_source

// Moedas (D369, Adendo 1, 11.2). Lista única das 17 moedas de conversão (e, a partir da 11.4, das lojas). A moeda base é sempre USD.
const CURRENCIES = Object.freeze(['USD', 'BRL', 'EUR', 'RUB', 'TRY', 'CNY', 'PLN', 'UAH', 'JPY', 'KRW', 'GBP', 'KZT', 'CAD', 'AUD', 'MXN', 'ARS', 'CLP']);
// Moedas sem casas decimais (Intl.NumberFormat(...).resolvedOptions().maximumFractionDigits = 0), fixadas aqui. O valor continua
// em "centavos" (1/100 da unidade); nelas a unidade mínima é 100 centavos.
const ZERO_DECIMAL_CURRENCIES = Object.freeze(['JPY', 'KRW', 'CLP']);
// Moeda de conversão padrão de uma instalação nova (A2). Os bancos existentes recebem BRL na migração v024.
const DEFAULT_DISPLAY_CURRENCY = 'USD';
// Pares USD-XXX da AwesomeAPI (economia.awesomeapi.com.br). VERIFICADO em 2026-11-25 com GET /json/available e GET /json/last/USD-XXX:
// as 16 moedas não-USD existem e responderam com code USD, codein igual à moeda, `ask`, `bid` e `timestamp`. Observações: UAH e KZT
// têm spread grande entre `bid` e `ask` (a venda, `ask`, é a usada, como no BRL); CNY pode ter a data do dia anterior. Moeda fora desta
// lista não tem atualização automática (FX_SOURCE_NOT_SUPPORTED) e fica só manual (E-P3-Q16).
const AWESOMEAPI_PAIRS = Object.freeze(['BRL', 'EUR', 'RUB', 'TRY', 'CNY', 'PLN', 'UAH', 'JPY', 'KRW', 'GBP', 'KZT', 'CAD', 'AUD', 'MXN', 'ARS', 'CLP']);
// Faixa de sanidade da cotação ("unidades da moeda por 1 US$") por moeda. O BRL mantém [1, 50] (FX_MIN_RATE/FX_MAX_RATE).
const FX_RATE_BOUNDS = Object.freeze({
  BRL: Object.freeze({ min: 1, max: 50 }),
  EUR: Object.freeze({ min: 0.2, max: 5 }),
  RUB: Object.freeze({ min: 10, max: 1000 }),
  TRY: Object.freeze({ min: 1, max: 500 }),
  CNY: Object.freeze({ min: 1, max: 30 }),
  PLN: Object.freeze({ min: 0.5, max: 30 }),
  UAH: Object.freeze({ min: 5, max: 500 }),
  JPY: Object.freeze({ min: 20, max: 2000 }),
  KRW: Object.freeze({ min: 200, max: 20000 }),
  GBP: Object.freeze({ min: 0.2, max: 5 }),
  KZT: Object.freeze({ min: 50, max: 5000 }),
  CAD: Object.freeze({ min: 0.5, max: 10 }),
  AUD: Object.freeze({ min: 0.5, max: 10 }),
  MXN: Object.freeze({ min: 3, max: 200 }),
  ARS: Object.freeze({ min: 10, max: 100000 }),
  CLP: Object.freeze({ min: 100, max: 10000 }),
});

// Faixa larga da cotação DIGITADA à mão (11.3), por moeda: só barra erro absurdo de digitação (vírgula no lugar errado, zero a mais).
// Bem mais larga que FX_RATE_BOUNDS (a das fontes automáticas) e com margem ampla (cerca de 10x para cada lado) em torno do valor de
// hoje. Vale só na escrita: cotações já gravadas fora da faixa continuam sendo lidas normalmente.
const FX_MANUAL_RATE_BOUNDS = Object.freeze({
  BRL: Object.freeze({ min: 0.5, max: 100 }),
  EUR: Object.freeze({ min: 0.1, max: 10 }),
  RUB: Object.freeze({ min: 5, max: 1500 }),
  TRY: Object.freeze({ min: 0.5, max: 1000 }),
  CNY: Object.freeze({ min: 0.5, max: 70 }),
  PLN: Object.freeze({ min: 0.25, max: 40 }),
  UAH: Object.freeze({ min: 2, max: 1000 }),
  JPY: Object.freeze({ min: 10, max: 3000 }),
  KRW: Object.freeze({ min: 100, max: 30000 }),
  GBP: Object.freeze({ min: 0.1, max: 10 }),
  KZT: Object.freeze({ min: 25, max: 10000 }),
  CAD: Object.freeze({ min: 0.15, max: 15 }),
  AUD: Object.freeze({ min: 0.15, max: 15 }),
  MXN: Object.freeze({ min: 1.5, max: 300 }),
  ARS: Object.freeze({ min: 5, max: 500000 }),
  CLP: Object.freeze({ min: 50, max: 20000 }),
});

// Backup (D150, D151).
const BACKUP_MAX_BYTES = 100 * 1024 * 1024;
const { AUTO_BACKUP_KEEP } = require('./backupRetention'); // retenção dos backups automáticos (D151)
const SQLITE_APPLICATION_ID = 1397444935; // 'SKMG' (v4, D143)

// Integração CSFloat (D288, D289, D316).
const CSFLOAT_API_BASE_URL = 'https://csfloat.com/api/v1';
const CSFLOAT_CALL_TIMEOUT_MS = 30000;
const CSFLOAT_TEST_TOTAL_TIMEOUT_MS = 40000;
const CSFLOAT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const CSFLOAT_RATE_LIMIT_MAX_WAIT_MS = 30000;
const API_KEY_MIN_LENGTH = 8;
const API_KEY_MAX_LENGTH = 512;
const CSFLOAT_HELP_URL = 'https://csfloat.com/profile';
// Importação (D318, 9.2).
const CSFLOAT_IMPORT_TOTAL_TIMEOUT_MS = 240000;
const CSFLOAT_PAGE_LIMIT = 50;
const CSFLOAT_MAX_PAGES = 200;
const CSFLOAT_PAGE_DELAY_MS = 250;
const IMPORT_RECHECK_WINDOW_MS = 2 * 86400000;
const IMPORT_OPEN_GRACE_MS = 2 * 86400000;
const IMPORT_DEFAULT_TRADE_LOCK_DAYS = 7;
const IMPORT_BATCHES_PAGE_SIZE = 20;
// Valor de mercado (D364, 10.5): cache de preços do CSFloat, atualizado só pelo botão ou ao abrir o app.
const MARKET_PRICE_STALE_HOURS = 24;
const VALUATION_CALL_DELAY_MS = 1000;
const VALUATION_FALLBACK_MAX_KEYS = 50; // teto de segurança quando a fonte não manda os headers de limite
const VALUATION_TOTAL_TIMEOUT_MS = 240000;
const VALUATION_RATE_LIMIT_RESERVE = 3;
// Intervalo mínimo entre rodadas de atualização de preços (o instante fica no banco: vale entre reinícios).
const VALUATION_COOLDOWN_MS = 15 * 60000;
// Colunas com segredo (D290): zeradas em todo arquivo de backup que sai do banco (exportação e backups automáticos).
const SECRET_COLUMNS = Object.freeze([Object.freeze({ table: 'integrations', column: 'api_key' })]);

module.exports = Object.freeze({
  MARKET_PRICE_STALE_HOURS,
  VALUATION_CALL_DELAY_MS,
  VALUATION_FALLBACK_MAX_KEYS,
  VALUATION_TOTAL_TIMEOUT_MS,
  VALUATION_RATE_LIMIT_RESERVE,
  VALUATION_COOLDOWN_MS,
  CSFLOAT_IMPORT_TOTAL_TIMEOUT_MS,
  CSFLOAT_PAGE_LIMIT,
  CSFLOAT_MAX_PAGES,
  CSFLOAT_PAGE_DELAY_MS,
  IMPORT_RECHECK_WINDOW_MS,
  IMPORT_OPEN_GRACE_MS,
  IMPORT_DEFAULT_TRADE_LOCK_DAYS,
  IMPORT_BATCHES_PAGE_SIZE,
  CSFLOAT_API_BASE_URL,
  CSFLOAT_CALL_TIMEOUT_MS,
  CSFLOAT_TEST_TOTAL_TIMEOUT_MS,
  CSFLOAT_MAX_RESPONSE_BYTES,
  CSFLOAT_RATE_LIMIT_MAX_WAIT_MS,
  API_KEY_MIN_LENGTH,
  API_KEY_MAX_LENGTH,
  CSFLOAT_HELP_URL,
  SECRET_COLUMNS,
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
  AWESOMEAPI_LAST_URL_PREFIX,
  AWESOMEAPI_TIMEOUT_MS,
  CURRENCIES,
  ZERO_DECIMAL_CURRENCIES,
  DEFAULT_DISPLAY_CURRENCY,
  AWESOMEAPI_PAIRS,
  FX_RATE_BOUNDS,
  FX_MANUAL_RATE_BOUNDS,
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
  CATALOG_LANGUAGE_FOLDERS,
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
  INVENTORY_VIEWS,
  // Campos de aquisição que o item obtido numa abertura nunca aceita: ele herda tudo da operação (D363 item 4). Fonte única (S2).
  GENERATED_FORBIDDEN_FIELDS: Object.freeze(['acquisitionType', 'purchaseStoreId', 'purchasePriceCents', 'fxRateAtPurchase', 'acquiredAt']),
});
