'use strict';

// Textos dos diálogos nativos (D179, E7-Q19, D369): o inglês é o idioma base (reserva de idioma desconhecido e de chave ausente);
// o pt-BR é o outro idioma disponível hoje. O idioma vem das configurações do app. Acrescentar um idioma = uma entrada em MESSAGES
// (o teste exige as mesmas chaves e os mesmos {marcadores} do inglês, sem texto vazio).
const MESSAGES = {
  en: {
    'common.close': 'Close',
    'common.openDataFolder': 'Open data folder',
    'common.openLogsFolder': 'Open logs folder',
    'common.openInBrowser': 'Open in browser',
    'startFailure.title': 'Skins Manager did not start',
    'startFailure.message': 'Skins Manager could not be started.',
    'startFailure.timeout': 'The internal server did not respond. Check the logs for details.',
    'startFailure.exited': 'The internal server exited while starting. Check the logs for details.',
    'alreadyOpen.title': 'Skins Manager is already open',
    'alreadyOpen.message': 'Skins Manager is already open through start-app.bat at http://localhost:{port}.',
    'alreadyOpen.detail': 'Close that window to use the desktop app, or keep using the browser.',
    'noPort.title': 'No free port',
    'noPort.message': 'There is no free port between 3001 and 3010 for the internal server.',
    'noPort.detail': 'Close programs that use these ports and open Skins Manager again.',
    'crashLoop.title': 'Internal server stopped',
    'crashLoop.message': 'The Skins Manager internal server stopped several times.',
    'crashLoop.detail': 'Your data is in {dataDir}.',
    'crashLoop.retry': 'Try again',
    'stageMissing.title': 'App not prepared',
    'stageMissing.message': 'The app files were not assembled. Run "npm run desktop:dev" from the project root.',
    'renderGone.title': 'The window stopped responding',
    'renderGone.message': 'The Skins Manager window crashed repeatedly. Close and reopen the app.',
  },
  'pt-BR': {
    'common.close': 'Fechar',
    'common.openDataFolder': 'Abrir pasta de dados',
    'common.openLogsFolder': 'Abrir pasta de logs',
    'common.openInBrowser': 'Abrir no navegador',
    'startFailure.title': 'Skins Manager não iniciou',
    'startFailure.message': 'Não foi possível iniciar o Skins Manager.',
    'startFailure.timeout': 'O servidor interno não respondeu. Veja os logs para mais detalhes.',
    'startFailure.exited': 'O servidor interno encerrou ao iniciar. Veja os logs para mais detalhes.',
    'alreadyOpen.title': 'Skins Manager já está aberto',
    'alreadyOpen.message': 'O Skins Manager já está aberto pelo start-app.bat em http://localhost:{port}.',
    'alreadyOpen.detail': 'Feche aquela janela para usar o app desktop, ou continue no navegador.',
    'noPort.title': 'Nenhuma porta livre',
    'noPort.message': 'Não há porta livre entre 3001 e 3010 para o servidor interno.',
    'noPort.detail': 'Feche programas que usam essas portas e abra o Skins Manager de novo.',
    'crashLoop.title': 'Servidor interno parado',
    'crashLoop.message': 'O servidor interno do Skins Manager parou várias vezes.',
    'crashLoop.detail': 'Seus dados estão em {dataDir}.',
    'crashLoop.retry': 'Tentar de novo',
    'stageMissing.title': 'App não preparado',
    'stageMissing.message': 'Os arquivos do app não foram montados. Rode "npm run desktop:dev" na raiz do projeto.',
    'renderGone.title': 'A janela parou de responder',
    'renderGone.message': 'A janela do Skins Manager travou repetidas vezes. Feche e abra o app de novo.',
  },
};

const DEFAULT_LANGUAGE = 'en';
const LANGUAGES = Object.freeze(Object.keys(MESSAGES));

function normalizeLanguage(language) {
  return Object.prototype.hasOwnProperty.call(MESSAGES, language) ? language : DEFAULT_LANGUAGE;
}

// Idioma do sistema (ex.: "pt-BR", "pt", "en-US") -> um idioma disponível; sem correspondência, o inglês. Só serve de valor
// inicial, antes de o app responder com o idioma das configurações.
function languageFromLocale(locale) {
  if (typeof locale !== 'string' || locale.trim() === '') return DEFAULT_LANGUAGE;
  const wanted = locale.trim().replace(/_/g, '-').toLowerCase();
  const exact = LANGUAGES.find((code) => code.toLowerCase() === wanted);
  if (exact) return exact;
  const base = wanted.split('-')[0];
  const sameBase = LANGUAGES.filter((code) => code.toLowerCase().split('-')[0] === base);
  if (sameBase.length === 0) return DEFAULT_LANGUAGE;
  return sameBase.find((code) => code.toLowerCase() === base) || sameBase[0];
}

function translate(language, key, params = {}) {
  const own = (dict) => (Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : undefined);
  const text = own(MESSAGES[normalizeLanguage(language)]) ?? own(MESSAGES[DEFAULT_LANGUAGE]) ?? String(key);
  return text.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])));
}

module.exports = { translate, normalizeLanguage, languageFromLocale, MESSAGES, LANGUAGES, DEFAULT_LANGUAGE };
