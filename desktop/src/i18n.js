'use strict';

// Textos dos diálogos nativos (D179, E7-Q19, D369): o inglês é o idioma base (reserva de idioma desconhecido e de chave ausente);
// pt-BR, es, fr, it e de acompanham (es/fr/it/de traduzidos pelo Claude, 11.7). O idioma vem das configurações do app. Acrescentar um idioma = uma entrada em MESSAGES
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
  es: {
    'common.close': 'Cerrar',
    'common.openDataFolder': 'Abrir carpeta de datos',
    'common.openLogsFolder': 'Abrir carpeta de registros (logs)',
    'common.openInBrowser': 'Abrir en el navegador',
    'startFailure.title': 'Skins Manager no se inició',
    'startFailure.message': 'No se pudo iniciar Skins Manager.',
    'startFailure.timeout': 'Skins Manager no respondió al iniciarse. Intenta abrirlo de nuevo. Si sigue pasando, mira los detalles en la carpeta de registros.',
    'startFailure.exited': 'Skins Manager se cerró solo al iniciarse. Intenta de nuevo. Si sigue pasando, mira el motivo en la carpeta de registros.',
    'alreadyOpen.title': 'Skins Manager ya está abierto',
    'alreadyOpen.message': 'Skins Manager ya está abierto con start-app.bat en http://localhost:{port}.',
    'alreadyOpen.detail': 'Cierra esa ventana para usar la app de escritorio, o sigue usando el navegador.',
    'noPort.title': 'Skins Manager no pudo abrirse',
    'noPort.message': 'Otros programas están usando todos los puertos que necesita la app (del 3001 al 3010).',
    'noPort.detail': 'Cierra otros programas y abre Skins Manager de nuevo. Si sigue pasando, reinicia el equipo.',
    'crashLoop.title': 'Skins Manager se detuvo',
    'crashLoop.message': 'Skins Manager se detuvo varias veces y no pudo continuar.',
    'crashLoop.detail': 'Tus datos siguen guardados en {dataDir}.',
    'crashLoop.retry': 'Intentar de nuevo',
    'stageMissing.title': 'App no preparada',
    'stageMissing.message': 'Los archivos de la app no se armaron. Ejecuta "npm run desktop:dev" en la raíz del proyecto.',
    'renderGone.title': 'La ventana dejó de responder',
    'renderGone.message': 'La ventana de Skins Manager se bloqueó varias veces. Cierra y vuelve a abrir la app.',
  },
  fr: {
    'common.close': 'Fermer',
    'common.openDataFolder': 'Ouvrir le dossier des données',
    'common.openLogsFolder': 'Ouvrir le dossier des journaux (logs)',
    'common.openInBrowser': 'Ouvrir dans le navigateur',
    'startFailure.title': 'Skins Manager ne s\'est pas lancé',
    'startFailure.message': 'Impossible de lancer Skins Manager.',
    'startFailure.timeout': 'Skins Manager n\'a pas répondu au démarrage. Essayez de le rouvrir. Si le problème continue, consultez les détails dans le dossier des journaux.',
    'startFailure.exited': 'Skins Manager s\'est fermé tout seul au démarrage. Réessayez. Si le problème continue, consultez la cause dans le dossier des journaux.',
    'alreadyOpen.title': 'Skins Manager est déjà ouvert',
    'alreadyOpen.message': 'Skins Manager est déjà ouvert via start-app.bat à l\'adresse http://localhost:{port}.',
    'alreadyOpen.detail': 'Fermez cette fenêtre pour utiliser l\'app de bureau, ou continuez dans le navigateur.',
    'noPort.title': 'Skins Manager n\'a pas pu s\'ouvrir',
    'noPort.message': 'D\'autres programmes utilisent tous les ports dont l\'app a besoin (3001 à 3010).',
    'noPort.detail': 'Fermez les autres programmes et rouvrez Skins Manager. Si le problème continue, redémarrez l\'ordinateur.',
    'crashLoop.title': 'Skins Manager s\'est arrêté',
    'crashLoop.message': 'Skins Manager s\'est arrêté plusieurs fois et n\'a pas pu continuer.',
    'crashLoop.detail': 'Vos données restent enregistrées dans {dataDir}.',
    'crashLoop.retry': 'Réessayer',
    'stageMissing.title': 'App non préparée',
    'stageMissing.message': 'Les fichiers de l\'app n\'ont pas été assemblés. Exécutez « npm run desktop:dev » à la racine du projet.',
    'renderGone.title': 'La fenêtre ne répond plus',
    'renderGone.message': 'La fenêtre de Skins Manager a planté à plusieurs reprises. Fermez l\'app et rouvrez-la.',
  },
  it: {
    'common.close': 'Chiudi',
    'common.openDataFolder': 'Apri la cartella dei dati',
    'common.openLogsFolder': 'Apri la cartella dei log',
    'common.openInBrowser': 'Apri nel browser',
    'startFailure.title': 'Skins Manager non si è avviato',
    'startFailure.message': 'Non è stato possibile avviare Skins Manager.',
    'startFailure.timeout': 'Skins Manager non ha risposto all\'avvio. Prova ad aprirlo di nuovo. Se succede ancora, controlla i dettagli nella cartella dei log.',
    'startFailure.exited': 'Skins Manager si è chiuso da solo all\'avvio. Riprova. Se succede ancora, controlla il motivo nella cartella dei log.',
    'alreadyOpen.title': 'Skins Manager è già aperto',
    'alreadyOpen.message': 'Skins Manager è già aperto tramite start-app.bat all\'indirizzo http://localhost:{port}.',
    'alreadyOpen.detail': 'Chiudi quella finestra per usare l\'app desktop, oppure continua nel browser.',
    'noPort.title': 'Skins Manager non è riuscito ad aprirsi',
    'noPort.message': 'Altri programmi stanno usando tutte le porte di cui l\'app ha bisogno (da 3001 a 3010).',
    'noPort.detail': 'Chiudi gli altri programmi e riapri Skins Manager. Se succede ancora, riavvia il computer.',
    'crashLoop.title': 'Skins Manager si è fermato',
    'crashLoop.message': 'Skins Manager si è fermato più volte e non è riuscito a continuare.',
    'crashLoop.detail': 'I tuoi dati restano salvati in {dataDir}.',
    'crashLoop.retry': 'Riprova',
    'stageMissing.title': 'App non preparata',
    'stageMissing.message': 'I file dell\'app non sono stati assemblati. Esegui "npm run desktop:dev" dalla radice del progetto.',
    'renderGone.title': 'La finestra ha smesso di rispondere',
    'renderGone.message': 'La finestra di Skins Manager si è bloccata più volte. Chiudi e riapri l\'app.',
  },
  de: {
    'common.close': 'Schließen',
    'common.openDataFolder': 'Datenordner öffnen',
    'common.openLogsFolder': 'Protokollordner (Logs) öffnen',
    'common.openInBrowser': 'Im Browser öffnen',
    'startFailure.title': 'Skins Manager wurde nicht gestartet',
    'startFailure.message': 'Skins Manager konnte nicht gestartet werden.',
    'startFailure.timeout': 'Skins Manager hat beim Start nicht geantwortet. Versuch, ihn nochmal zu öffnen. Wenn es weiter passiert, sieh dir die Details im Protokollordner an.',
    'startFailure.exited': 'Skins Manager hat sich beim Start von selbst geschlossen. Versuch es nochmal. Wenn es weiter passiert, sieh dir den Grund im Protokollordner an.',
    'alreadyOpen.title': 'Skins Manager ist schon geöffnet',
    'alreadyOpen.message': 'Skins Manager ist schon über start-app.bat unter http://localhost:{port} geöffnet.',
    'alreadyOpen.detail': 'Schließe dieses Fenster, um die Desktop-App zu nutzen, oder arbeite im Browser weiter.',
    'noPort.title': 'Skins Manager konnte nicht geöffnet werden',
    'noPort.message': 'Andere Programme belegen alle Ports, die die App braucht (3001 bis 3010).',
    'noPort.detail': 'Schließe andere Programme und öffne Skins Manager nochmal. Wenn es weiter passiert, starte den Computer neu.',
    'crashLoop.title': 'Skins Manager wurde beendet',
    'crashLoop.message': 'Skins Manager wurde mehrmals beendet und konnte nicht weiterlaufen.',
    'crashLoop.detail': 'Deine Daten sind weiterhin in {dataDir} gespeichert.',
    'crashLoop.retry': 'Nochmal versuchen',
    'stageMissing.title': 'App nicht vorbereitet',
    'stageMissing.message': 'Die App-Dateien wurden nicht zusammengestellt. Führe „npm run desktop:dev“ im Hauptordner des Projekts aus.',
    'renderGone.title': 'Das Fenster antwortet nicht mehr',
    'renderGone.message': 'Das Fenster von Skins Manager ist mehrmals abgestürzt. Schließe die App und öffne sie neu.',
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
