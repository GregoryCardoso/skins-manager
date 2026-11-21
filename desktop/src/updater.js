'use strict';

// Atualização do app desktop (D181). Três modos:
//  - installer: electron-updater (GitHub Releases), com duas confirmações; nada baixa nem instala sem resposta.
//  - portable: o electron-updater não suporta; consulta releases/latest e só avisa, com link para a página.
//  - dev (app não empacotado): sem verificação.
// Tudo que depende do Electron entra por injeção, para ser testável sem janela.
const https = require('https');
const {
  LATEST_RELEASE_API_URL,
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  evaluateLatestRelease,
  formatReleaseNotes,
} = require('./lib/updatePolicy');

const AUTO_CHECK_DELAY_MS = 10 * 1000;

function detectMode({ isPackaged, env }) {
  if (!isPackaged) return 'dev';
  return env && env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installer';
}

// GET com timeout de 10 s e teto de 256 KB; devolve o JSON já interpretado (lança em qualquer falha).
function fetchLatestRelease(url = LATEST_RELEASE_API_URL) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { 'User-Agent': 'SkinsManager', Accept: 'application/vnd.github+json' }, timeout: REQUEST_TIMEOUT_MS },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            request.destroy(new Error('Resposta grande demais.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (err) {
            reject(new Error('JSON inválido.'));
          }
        });
        response.on('error', reject);
      }
    );
    request.on('timeout', () => request.destroy(new Error('Tempo esgotado.')));
    request.on('error', reject);
  });
}

function createUpdater({
  app,
  shell,
  dialogs,
  getLanguage,
  getParent = () => null,
  getWindow = () => null,
  stopBackend = async () => {},
  logger = { info() {}, error() {} },
  env = process.env,
  loadAutoUpdater = () => require('electron-updater').autoUpdater,
  fetchLatest = fetchLatestRelease,
  setTimeoutFn = setTimeout,
  autoCheckDelayMs = AUTO_CHECK_DELAY_MS,
}) {
  const mode = detectMode({ isPackaged: app.isPackaged, env });
  const currentVersion = () => app.getVersion();
  const errText = (err) => (err && err.message ? err.message : String(err));

  let checking = false; // consulta em andamento
  let flowActive = false; // diálogos/download em andamento
  let autoUpdater = null;
  let downloadedVersion = null; // atualização baixada, aguardando reiniciar/fechar
  let installOnQuit = false;

  function getAutoUpdater() {
    if (autoUpdater) return autoUpdater;
    autoUpdater = loadAutoUpdater();
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = {
      info: (m) => logger.info(`[updater] ${m}`),
      warn: (m) => logger.info(`[updater] ${m}`),
      error: (m) => logger.error(`[updater] ${m}`),
      debug: () => {},
    };
    autoUpdater.on('download-progress', (progress) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) win.setProgressBar(Math.min(1, Math.max(0, (progress.percent || 0) / 100)));
    });
    return autoUpdater;
  }

  function clearProgress() {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
  }

  async function restartNow() {
    logger.info('Reiniciando para instalar a atualização.');
    await stopBackend(); // shutdown normal do backend (D177) antes de o instalador substituir os arquivos
    getAutoUpdater().quitAndInstall(false, true);
  }

  async function askRestart(language) {
    const choice = await dialogs.showUpdateReady({ parent: getParent(), language, version: downloadedVersion });
    if (choice === 'restart') {
      await restartNow();
    } else {
      installOnQuit = true;
      logger.info('Atualização será instalada ao fechar o app.');
    }
  }

  // Segunda parte do fluxo do instalador: depois de "há versão nova".
  async function installerFlow(info) {
    const language = await getLanguage();
    const answer = await dialogs.showUpdateAvailable({
      parent: getParent(),
      language,
      version: info.version,
      current: currentVersion(),
      notes: formatReleaseNotes(info.releaseNotes),
    });
    if (answer !== 'download') {
      logger.info('Atualização adiada pelo usuário.');
      return;
    }
    try {
      await getAutoUpdater().downloadUpdate();
    } catch (err) {
      logger.error(`Falha ao baixar a atualização: ${errText(err)}`);
      clearProgress();
      await dialogs.showUpdateError({ parent: getParent(), language: await getLanguage(), reason: errText(err) });
      return;
    }
    clearProgress();
    downloadedVersion = info.version;
    await askRestart(await getLanguage());
  }

  async function checkInstaller() {
    const result = await getAutoUpdater().checkForUpdates(); // `manual` só muda o tratamento de erro, em check()
    if (!result || !result.updateInfo || !result.isUpdateAvailable) {
      return { status: 'up-to-date', latestVersion: result && result.updateInfo ? result.updateInfo.version : undefined };
    }
    const info = result.updateInfo;
    runDetached(() => installerFlow(info));
    return { status: 'available', latestVersion: info.version };
  }

  async function checkPortable() {
    const json = await fetchLatest();
    const decision = evaluateLatestRelease(json, currentVersion());
    if (decision.status === 'invalid') throw new Error('Resposta inválida do GitHub.');
    if (decision.status !== 'available') return { status: 'up-to-date', latestVersion: decision.latestVersion };
    runDetached(async () => {
      const answer = await dialogs.showPortableUpdate({
        parent: getParent(),
        language: await getLanguage(),
        version: decision.latestVersion,
        current: currentVersion(),
        notes: formatReleaseNotes(decision.notes),
      });
      if (answer === 'open') await shell.openExternal(decision.url); // URL já validada pelo updatePolicy
    });
    return { status: 'available', latestVersion: decision.latestVersion };
  }

  // Os diálogos rodam em segundo plano; `flowActive` só solta no fim, para não abrir dois fluxos.
  function runDetached(fn) {
    flowActive = true;
    Promise.resolve()
      .then(fn)
      .catch((err) => logger.error(`Erro no fluxo de atualização: ${errText(err)}`))
      .finally(() => {
        flowActive = false;
      });
  }

  // `manual`: vindo do botão (erro vira status 'error'); automático: erro só no log.
  async function check({ manual = false } = {}) {
    const base = { mode, currentVersion: currentVersion() };
    if (mode === 'dev') return { ...base, status: 'disabled' };
    if (checking || flowActive) return { ...base, status: 'busy' };
    if (downloadedVersion) {
      // já baixada: oferece o reinício de novo
      if (manual) {
        runDetached(async () => askRestart(await getLanguage()));
      }
      return { ...base, status: 'ready', latestVersion: downloadedVersion };
    }
    checking = true;
    try {
      const outcome = mode === 'portable' ? await checkPortable() : await checkInstaller();
      return { ...base, ...outcome };
    } catch (err) {
      logger.error(`Falha ao verificar atualizações (${manual ? 'manual' : 'automática'}): ${errText(err)}`);
      return { ...base, status: 'error' };
    } finally {
      checking = false;
    }
  }

  // Verificação automática única, ~10 s depois de abrir (só instalador e portátil).
  function scheduleAutoCheck() {
    if (mode === 'dev') return;
    const timer = setTimeoutFn(() => {
      check({ manual: false }).catch((err) => logger.error(`Erro na verificação automática: ${errText(err)}`));
    }, autoCheckDelayMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  // "Instalar ao fechar o app": chamado pelo main depois de o backend encerrar, no before-quit.
  // Sem autoInstallOnAppQuit global, a instalação é pedida aqui, só se o usuário escolheu essa opção.
  function installPendingOnQuit() {
    if (!installOnQuit || !downloadedVersion) return false;
    installOnQuit = false;
    try {
      logger.info('Instalando a atualização ao fechar o app.');
      getAutoUpdater().quitAndInstall(true, false);
      return true;
    } catch (err) {
      logger.error(`Falha ao instalar ao fechar: ${errText(err)}`);
      return false;
    }
  }

  return { mode, check, scheduleAutoCheck, installPendingOnQuit };
}

module.exports = { createUpdater, detectMode, fetchLatestRelease, AUTO_CHECK_DELAY_MS };
