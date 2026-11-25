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
    'startFailure.timeout': 'Skins Manager did not respond when starting. Try opening it again. If it keeps happening, check the logs folder for details.',
    'startFailure.exited': 'Skins Manager closed by itself while starting. Try again. If it keeps happening, check the logs folder for the reason.',
    'alreadyOpen.title': 'Skins Manager is already open',
    'alreadyOpen.message': 'Skins Manager is already open through start-app.bat at http://localhost:{port}.',
    'alreadyOpen.detail': 'Close that window to use the desktop app, or keep using the browser.',
    'noPort.title': 'Skins Manager could not open',
    'noPort.message': 'Other programs are using all the ports the app needs (3001 to 3010).',
    'noPort.detail': 'Close other programs and open Skins Manager again. If it keeps happening, restart the computer.',
    'crashLoop.title': 'Skins Manager stopped',
    'crashLoop.message': 'Skins Manager stopped several times and could not continue.',
    'crashLoop.detail': 'Your data is still saved in {dataDir}.',
    'crashLoop.retry': 'Try again',
    'stageMissing.title': 'App not prepared',
    'stageMissing.message': 'The app files were not assembled. Run "npm run desktop:dev" from the project root.',
    'renderGone.title': 'The window stopped responding',
    'renderGone.message': 'The Skins Manager window crashed repeatedly. Close and reopen the app.',
  },
  'pt-BR': {
    'common.close': 'Fechar',
    'common.openDataFolder': 'Abrir pasta de dados',
    'common.openLogsFolder': 'Abrir pasta de registros (logs)',
    'common.openInBrowser': 'Abrir no navegador',
    'startFailure.title': 'Skins Manager não iniciou',
    'startFailure.message': 'Não foi possível iniciar o Skins Manager.',
    'startFailure.timeout': 'O Skins Manager não respondeu ao abrir. Tente abrir de novo. Se continuar, veja os detalhes na pasta de registros.',
    'startFailure.exited': 'O Skins Manager fechou sozinho ao abrir. Tente de novo. Se continuar, veja o motivo na pasta de registros.',
    'alreadyOpen.title': 'Skins Manager já está aberto',
    'alreadyOpen.message': 'O Skins Manager já está aberto pelo start-app.bat em http://localhost:{port}.',
    'alreadyOpen.detail': 'Feche aquela janela para usar o app desktop, ou continue no navegador.',
    'noPort.title': 'O Skins Manager não conseguiu abrir',
    'noPort.message': 'Outros programas estão usando todas as portas de que o app precisa (3001 a 3010).',
    'noPort.detail': 'Feche outros programas e abra o Skins Manager de novo. Se continuar, reinicie o computador.',
    'crashLoop.title': 'O Skins Manager parou',
    'crashLoop.message': 'O Skins Manager parou várias vezes e não conseguiu continuar.',
    'crashLoop.detail': 'Seus dados continuam salvos em {dataDir}.',
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
  const parts = wanted.split('-');
  const base = parts[0];
  // Mesma regra do frontend (matchLanguage): o chinês tradicional nunca vira o simplificado.
  if (base === 'zh' && parts.slice(1).some((part) => part === 'hant' || part === 'tw' || part === 'hk' || part === 'mo')) return DEFAULT_LANGUAGE;
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
