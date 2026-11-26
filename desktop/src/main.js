'use strict';

// Processo principal do Skins Manager desktop (D176 a D179): instância única, escolha da porta, backend
// supervisionado em processo separado, janela com a interface servida pelo próprio backend.
const fs = require('fs');
const path = require('path');
const { app, Menu, nativeTheme, screen, shell, utilityProcess } = require('electron');

const paths = require('./lib/paths');
const { createRotatingLog } = require('./lib/logRotation');
const { pickPort, checkPortFree, probeSkinsManager } = require('./lib/portPicker');
const { createBackendSupervisor } = require('./backendSupervisor');
const windowSetup = require('./window');
const { backgroundFor } = require('./lib/windowTheme');
const dialogs = require('./dialogs');
const { createScreens, LOADING_FILE } = require('./screens');
const { registerIpc, createStatePublisher } = require('./ipc');
const { createUpdater } = require('./updater');
const { normalizeLanguage, languageFromLocale } = require('./i18n');

const APP_USER_MODEL_ID = 'io.github.gregorycardoso.skinsmanager';

const dataDir = paths.resolveDataDir();
const dataPaths = paths.resolveDataPaths(dataDir);
const appPaths = paths.resolveAppPaths(
  paths.resolveAppRoot({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, desktopDir: path.join(__dirname, '..') })
);

// Dados internos do Chromium dentro da pasta de dados (D171); antes de qualquer outra coisa do Electron.
app.setName('Skins Manager');
app.setPath('userData', dataPaths.electronDir);
app.setAppUserModelId(APP_USER_MODEL_ID);

let mainLog = null;
let backendLog = null;
const logger = {
  info: (text) => writeMain('INFO', text),
  error: (text) => writeMain('ERROR', text),
  backend: (text) => {
    if (backendLog) backendLog.write(text.endsWith('\n') ? text : `${text}\n`);
  },
};

function writeMain(level, text) {
  const line = `${new Date().toISOString()} [${level}] ${text}\n`;
  if (mainLog) mainLog.write(line);
  if (!app.isPackaged) process.stdout.write(line);
}

let mainWindow = null;
let supervisor = null;
let updater = null;
let appOrigin = null;
let appPort = null;
let pageLoaded = false; // a interface (não a tela de carregamento) já foi carregada
let quitting = false;
let currentLanguage = null; // último idioma lido das configurações; null = ainda não lido

const getAppOrigin = () => appOrigin;

// Telas de início e de erro dentro da janela, com diálogo nativo de reserva (12.10).
const screens = createScreens({ dialogs, loadingFile: LOADING_FILE, logger });

// Sem idioma lido das configurações, usa o do sistema se for um dos disponíveis; senão, o inglês (D369).
function knownLanguage() {
  if (currentLanguage) return currentLanguage;
  try {
    return languageFromLocale(app.getLocale());
  } catch (err) {
    return languageFromLocale('');
  }
}

// Cor de fundo da janela pelo tema escolhido nas configurações (12.10), antes de a página pintar.
function applyWindowBackground(theme) {
  screens.setTheme(theme); // a tela de erro dentro da janela usa o mesmo tema
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setBackgroundColor(backgroundFor({ theme, systemDark: nativeTheme.shouldUseDarkColors }));
}

// Idioma dos diálogos (E7-Q19): lido de GET /api/settings; se o backend não responde, usa o último conhecido.
async function refreshLanguage(port) {
  if (!port) return knownLanguage();
  try {
    const response = await fetch(`http://localhost:${port}/api/settings`, { signal: AbortSignal.timeout(1000) });
    const json = await response.json();
    if (json && json.data) {
      currentLanguage = normalizeLanguage(json.data.language);
      applyWindowBackground(json.data.theme);
    }
  } catch (err) {
    // mantém o último idioma conhecido (ou o do sistema)
  }
  return knownLanguage();
}

// Porta do start-app.bat quando ele segura a pasta de dados (DATA_DIR_LOCKED): lida da trava (D173).
function readBrowserLockPort() {
  try {
    const info = JSON.parse(fs.readFileSync(dataPaths.lockPath, 'utf8'));
    if (info && info.mode === 'browser' && Number.isInteger(info.port) && info.port > 0 && info.port < 65536) return info.port;
  } catch (err) {
    // sem trava legível
  }
  return null;
}

// Janela que mostra as telas dentro dela (mesmo antes de aparecer); sem janela, o diálogo nativo assume.
function screenWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function getMainWebContents() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
}

function openInBrowser(port) {
  return shell.openExternal(`http://localhost:${port}/`).catch((err) => logger.error(`Falha ao abrir o navegador: ${err.message}`));
}

function quitApp() {
  app.quit();
}

// ---- Reações do supervisor ----

async function onBackendReady({ port, restarted }) {
  appPort = port;
  appOrigin = `http://localhost:${port}`;
  await refreshLanguage(port);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (restarted && pageLoaded) {
    mainWindow.webContents.reload(); // volta do painel "backend fora do ar" (D168)
  } else {
    pageLoaded = true;
    mainWindow.loadURL(`${appOrigin}/`).catch((err) => logger.error(`Falha ao carregar a interface: ${err.message}`));
  }
}

async function onStartupFailure({ code, message }) {
  const language = await refreshLanguage(appPort);
  const lockPort = code === 'DATA_DIR_LOCKED' ? readBrowserLockPort() : null;
  for (;;) {
    const choice = await screens.showStartFailure({
      parent: screenWindow(),
      language,
      code,
      message,
      browserUrl: lockPort ? `http://localhost:${lockPort}/` : null,
    });
    if (choice === 'retry' && supervisor) {
      pageLoaded = false;
      screens.showLoading(mainWindow);
      supervisor.retry(); // se falhar de novo, volta a esta tela
      return;
    }
    if (choice === 'open-data') {
      await shell.openPath(dataDir);
    } else if (choice === 'open-logs') {
      await shell.openPath(dataPaths.logsDir);
    } else if (choice === 'open-browser' && lockPort) {
      await openInBrowser(lockPort);
      break;
    } else {
      break;
    }
  }
  quitApp();
}

async function onGaveUp() {
  const language = await refreshLanguage(appPort);
  for (;;) {
    const choice = await screens.showCrashLoop({ parent: screenWindow(), language, dataDir });
    if (choice === 'retry') {
      pageLoaded = false; // a janela está na tela de erro; ao ficar pronto, carrega a interface de novo
      screens.showLoading(mainWindow);
      supervisor.retry();
      return;
    }
    if (choice === 'open-logs') {
      await shell.openPath(dataPaths.logsDir);
    } else {
      break;
    }
  }
  quitApp();
}

// ---- Inicialização ----

async function startup() {
  if (!fs.existsSync(appPaths.backendEntry)) {
    logger.error(`Backend não encontrado em ${appPaths.backendEntry}.`);
    await dialogs.showStageMissing({ language: knownLanguage() });
    quitApp();
    return;
  }

  mainWindow = windowSetup.createMainWindow({
    logger,
    workArea: screen.getPrimaryDisplay().workAreaSize,
    systemDark: nativeTheme.shouldUseDarkColors,
    onRenderGoneTwice: async () => {
      await screens.showRenderGone({ parent: screenWindow(), language: await refreshLanguage(appPort) });
      quitApp();
    },
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  windowSetup.showLoading(mainWindow).catch((err) => logger.error(`Falha ao mostrar a tela de carregamento: ${err.message}`));

  const choice = await pickPort({ isPortFree: checkPortFree, isSkinsManager: probeSkinsManager });
  logger.info(`Porta escolhida: ${JSON.stringify(choice)}`);

  if (choice.kind === 'already-running') {
    const language = await refreshLanguage(choice.port);
    const answer = await screens.showAlreadyOpen({ parent: screenWindow(), language, port: choice.port });
    if (answer === 'open-browser') await openInBrowser(choice.port);
    quitApp();
    return;
  }
  if (choice.kind === 'none') {
    await screens.showNoFreePort({ parent: screenWindow(), language: knownLanguage() });
    quitApp();
    return;
  }

  appPort = choice.port;
  supervisor = createBackendSupervisor({
    fork: (entry, args, options) => utilityProcess.fork(entry, args, options),
    entry: appPaths.backendEntry,
    cwd: appPaths.backendDir,
    dbPath: dataPaths.dbPath,
    logger,
    handlers: {
      onReady: onBackendReady,
      onStartupFailure,
      onGaveUp,
      onRestarting: ({ attempt, delayMs }) => logger.info(`Reiniciando o backend (tentativa ${attempt}) em ${delayMs} ms.`),
    },
  });
  supervisor.start({ port: choice.port });
}

// ---- Ciclo de vida ----

// Instância única (D179): a segunda abertura só traz a janela existente para a frente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => windowSetup.focusWindow(mainWindow));

  app.whenReady().then(() => {
    fs.mkdirSync(dataPaths.logsDir, { recursive: true });
    mainLog = createRotatingLog(path.join(dataPaths.logsDir, 'main.log'));
    backendLog = createRotatingLog(path.join(dataPaths.logsDir, 'backend.log'));
    logger.info(`Skins Manager desktop ${app.getVersion()} (Electron ${process.versions.electron}), dados em ${dataDir}.`);

    Menu.setApplicationMenu(null);
    windowSetup.installSessionSecurity();
    windowSetup.installGlobalGuards({ getAppOrigin, logger });
    updater = createUpdater({
      app,
      shell,
      logger,
      getWindow: () => mainWindow,
      // o modal de atualização fica na interface (D188); aqui só se envia o estado, e só à janela na origem do app
      publishState: createStatePublisher({ getWebContents: getMainWebContents, getAppOrigin }),
      stopBackend: async () => {
        if (supervisor) await supervisor.stop();
      },
      // religa o backend se o reinício para instalar falhar (a janela continua aberta)
      restartBackend: async () => {
        if (supervisor) supervisor.start({ port: appPort });
      },
    });
    registerIpc({
      getAppOrigin,
      getAppInfo: () => ({
        isDesktop: true,
        version: app.getVersion(),
        mode: updater.mode, // installer | portable | dev
        electron: process.versions.electron,
        port: appPort,
      }),
      checkForUpdates: () => updater.check({ manual: true }),
      getUpdateState: () => updater.getState(),
      respondToUpdate: (payload) => updater.respond(payload),
      getMainWebContents,
      loadingFile: LOADING_FILE,
      getScreenState: () => screens.getState(),
      chooseScreen: (id) => screens.choose(id),
    });
    updater.scheduleAutoCheck();

    startup().catch((err) => {
      logger.error(`Falha na inicialização: ${err && err.stack ? err.stack : err}`);
      quitApp();
    });
  });

  // Fechar a janela encerra tudo (sem bandeja).
  app.on('window-all-closed', () => app.quit());

  // Antes de sair, o backend encerra pela mensagem `shutdown` (checkpoint do WAL e libera a trava, D177).
  app.on('before-quit', (event) => {
    if (quitting || !supervisor) return;
    event.preventDefault();
    quitting = true;
    supervisor
      .stop()
      .catch((err) => logger.error(`Erro ao encerrar o backend: ${err && err.message ? err.message : err}`))
      .finally(() => {
        if (updater) updater.installPendingOnQuit(); // "instalar ao fechar o app" (D181)
        app.quit();
      });
  });
}
