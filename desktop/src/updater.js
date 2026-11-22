'use strict';

// Atualização do app desktop (D181, D188 a D191). Três modos:
//  - installer: electron-updater (GitHub Releases), com duas confirmações; nada baixa nem instala sem resposta.
//  - portable: o electron-updater não suporta; consulta releases/latest e só avisa, com link para a página.
//  - dev (app não empacotado): sem verificação.
// O main é o dono do estado (lib/updateState.js); a interface mostra o modal e responde pelo IPC (`respond`).
// Tudo que depende do Electron entra por injeção, para ser testável sem janela.
const https = require('https');
const {
  LATEST_RELEASE_API_URL,
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  evaluateLatestRelease,
  extractReleaseBody,
  formatReleaseNotes,
  limitReleaseNotes,
  releaseByTagApiUrl,
} = require('./lib/updatePolicy');
const { initialState, transition, isActionAllowed, parseRespondPayload } = require('./lib/updateState');

const AUTO_CHECK_DELAY_MS = 10 * 1000;
// Progresso enviado à interface: no máximo 1 por ponto percentual e 4 por segundo (D188).
const MIN_PROGRESS_INTERVAL_MS = 250;

function detectMode({ isPackaged, env }) {
  if (!isPackaged) return 'dev';
  return env && env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installer';
}

// GET com timeout de 10 s e teto de 256 KB; devolve o JSON já interpretado (lança em qualquer falha).
function fetchJson(url) {
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

function fetchLatestRelease(url = LATEST_RELEASE_API_URL) {
  return fetchJson(url);
}

// Argumentos do `quitAndInstall(isSilent, isForceRunAfter)` (D284). A atualização é sempre silenciosa (o NSIS roda com `/S`,
// sem o assistente); só a primeira instalação usa o instalador assistido. No electron-updater, `isForceRunAfter` só vale
// com `isSilent = true` (com `false`, reabrir depende de `autoRunAppAfterInstall` e o assistente aparece).
const SILENT = true;
const RUN_AFTER_RESTART = true; // "Reiniciar agora": reabre o app na versão nova
const RUN_AFTER_QUIT = false; // "Instalar ao fechar o app": instala e não reabre

function createUpdater({
  app,
  shell,
  publishState = () => {},
  getWindow = () => null,
  stopBackend = async () => {},
  restartBackend = async () => {},
  logger = { info() {}, error() {} },
  env = process.env,
  loadAutoUpdater = () => require('electron-updater').autoUpdater,
  fetchLatest = fetchLatestRelease,
  fetchJson: fetchJsonFn = fetchJson,
  setTimeoutFn = setTimeout,
  autoCheckDelayMs = AUTO_CHECK_DELAY_MS,
  nowFn = Date.now,
}) {
  const mode = detectMode({ isPackaged: app.isPackaged, env });
  const currentVersion = () => app.getVersion();
  const errText = (err) => (err && err.message ? err.message : String(err));

  let state = initialState({ mode, currentVersion: currentVersion() });
  let checking = false; // consulta em andamento
  let autoUpdater = null;
  let pendingVersion = null; // versão oferecida (fase available), a baixar se o usuário aceitar
  let downloadedVersion = null; // atualização baixada, aguardando reiniciar/fechar
  let installOnQuit = false; // só o clique explícito em "Instalar ao fechar o app" (V102-Q2)
  let portableUrl = null; // página da release (portátil); fica só aqui, nunca vai ao renderer
  let lastProgressAt = null;

  // Aplica um evento à máquina de estados e publica o novo estado. false se o evento não vale na fase atual.
  function apply(event) {
    const next = transition(state, event);
    if (next === state) return false;
    state = next;
    try {
      publishState(state);
    } catch (err) {
      logger.error(`Falha ao publicar o estado da atualização: ${errText(err)}`);
    }
    return true;
  }

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
      publishProgress(progress.percent);
    });
    return autoUpdater;
  }

  function publishProgress(rawPercent) {
    if (state.phase !== 'downloading') return;
    const percent = Math.min(100, Math.max(0, Math.floor(Number(rawPercent) || 0)));
    if (percent === state.percent) return;
    const now = nowFn();
    if (lastProgressAt !== null && now - lastProgressAt < MIN_PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    apply({ type: 'progress', percent });
  }

  function clearProgress() {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
  }

  // Reinício para instalar. Qualquer falha tira o modal de "Reiniciando..." e mostra o erro de instalação.
  async function restartNow() {
    logger.info('Reiniciando para instalar a atualização.');
    try {
      await stopBackend(); // shutdown normal do backend (D177) antes de o instalador substituir os arquivos
    } catch (err) {
      logger.error(`Falha ao encerrar o backend para instalar: ${errText(err)}`);
      apply({ type: 'installFailed', detail: errText(err) });
      return;
    }
    try {
      // Silencioso e reabrindo o app (D284): sem o assistente do NSIS; ele volta sozinho já na versão nova.
      getAutoUpdater().quitAndInstall(SILENT, RUN_AFTER_RESTART);
    } catch (err) {
      // O app continua aberto: sem o backend ele ficaria inutilizável. Religa e avisa.
      logger.error(`Falha ao reiniciar para instalar: ${errText(err)}`);
      try {
        await restartBackend();
      } catch (restartErr) {
        logger.error(`Falha ao religar o backend: ${errText(restartErr)}`);
      }
      apply({ type: 'installFailed', detail: errText(err) });
    }
  }

  async function downloadNow() {
    lastProgressAt = null;
    try {
      await getAutoUpdater().downloadUpdate();
    } catch (err) {
      logger.error(`Falha ao baixar a atualização: ${errText(err)}`);
      clearProgress();
      apply({ type: 'downloadFailed', detail: errText(err) });
      return;
    }
    clearProgress();
    downloadedVersion = pendingVersion;
    apply({ type: 'downloaded' });
  }

  function runDetached(fn) {
    Promise.resolve()
      .then(fn)
      .catch((err) => logger.error(`Erro no fluxo de atualização: ${errText(err)}`));
  }

  // Resposta do usuário vinda do modal (IPC `desktop:updateRespond`). Ação fora da fase ou `seq` velho: ignorada.
  function respond(payload) {
    const parsed = parseRespondPayload(payload);
    if (!parsed) {
      logger.info('Resposta de atualização ignorada: formato inválido.');
      return { accepted: false, state };
    }
    const { action, seq } = parsed;
    if (seq !== state.seq || !isActionAllowed(state.phase, action)) {
      logger.info(`Resposta de atualização ignorada: ação "${action}" na fase "${state.phase}" (seq ${seq}, atual ${state.seq}).`);
      return { accepted: false, state };
    }
    apply({ type: action });
    switch (action) {
      case 'download':
        runDetached(downloadNow);
        break;
      case 'restart':
        installOnQuit = false; // o reinício já instala; evita instalar de novo no before-quit
        runDetached(restartNow);
        break;
      case 'installOnQuit':
        installOnQuit = true;
        logger.info('Atualização será instalada ao fechar o app.');
        break;
      case 'later':
        logger.info('Atualização adiada pelo usuário.');
        break;
      case 'openDownloadPage':
        if (portableUrl) {
          runDetached(() => shell.openExternal(portableUrl)); // URL já validada pelo updatePolicy; nunca vem do renderer
        }
        break;
      default:
        break;
    }
    return { accepted: true, state };
  }

  // Notas em markdown (D191): corpo da release pela API do GitHub; se falhar, o texto do feed, sem HTML.
  async function loadInstallerNotes(info) {
    const url = releaseByTagApiUrl(info.version);
    if (url) {
      try {
        const body = extractReleaseBody(await fetchJsonFn(url), info.version);
        if (body !== null) return limitReleaseNotes(body);
        logger.error('Notas da versão: resposta inesperada do GitHub; usando o texto do feed.');
      } catch (err) {
        logger.error(`Notas da versão: falha ao buscar no GitHub (${errText(err)}); usando o texto do feed.`);
      }
    }
    return formatReleaseNotes(info.releaseNotes);
  }

  async function checkInstaller() {
    const result = await getAutoUpdater().checkForUpdates(); // `manual` só muda o tratamento de erro, em check()
    if (!result || !result.updateInfo || !result.isUpdateAvailable) {
      return { status: 'up-to-date', latestVersion: result && result.updateInfo ? result.updateInfo.version : undefined };
    }
    const info = result.updateInfo;
    const notes = await loadInstallerNotes(info);
    pendingVersion = info.version;
    apply({ type: 'found', version: info.version, currentVersion: currentVersion(), notes });
    return { status: 'available', latestVersion: info.version };
  }

  async function checkPortable() {
    const json = await fetchLatest();
    const decision = evaluateLatestRelease(json, currentVersion());
    if (decision.status === 'invalid') throw new Error('Resposta inválida do GitHub.');
    if (decision.status !== 'available') return { status: 'up-to-date', latestVersion: decision.latestVersion };
    portableUrl = decision.url;
    apply({
      type: 'found',
      version: decision.latestVersion,
      currentVersion: currentVersion(),
      notes: limitReleaseNotes(decision.notes),
    });
    return { status: 'available', latestVersion: decision.latestVersion };
  }

  // `manual`: vindo do botão (erro vira status 'error'); automático: erro só no log.
  async function check({ manual = false } = {}) {
    const base = { mode, currentVersion: currentVersion() };
    if (mode === 'dev') return { ...base, status: 'disabled' };
    if (state.phase === 'downloading') return { ...base, status: 'downloading', percent: state.percent };
    if (checking || ['available', 'installing', 'portable-available'].includes(state.phase)) {
      return { ...base, status: 'busy' };
    }
    if (downloadedVersion) {
      // já baixada: a verificação manual reabre o modal de "pronta" (mesmo depois de escondido, de "instalar ao fechar"
      // ou de um erro de instalação); a automática não incomoda
      if (manual) apply({ type: 'reopen', version: downloadedVersion });
      return { ...base, status: 'ready', latestVersion: downloadedVersion };
    }
    if (state.phase === 'error') apply({ type: 'clear' });
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
  // Sem autoInstallOnAppQuit global, a instalação é pedida aqui, só se o usuário escolheu essa opção (V102-Q2).
  // Fechar o app sem responder ao modal não instala; na próxima abertura a atualização é oferecida de novo e o
  // electron-updater reaproveita o instalador já baixado (cache em `pending`, conferido pelo sha512).
  function installPendingOnQuit() {
    if (!installOnQuit || !downloadedVersion) return false;
    installOnQuit = false;
    try {
      logger.info('Instalando a atualização ao fechar o app.');
      // Silencioso e sem reabrir (D284): o usuário fechou o app de propósito.
      getAutoUpdater().quitAndInstall(SILENT, RUN_AFTER_QUIT);
      return true;
    } catch (err) {
      logger.error(`Falha ao instalar ao fechar: ${errText(err)}`);
      return false;
    }
  }

  return { mode, check, scheduleAutoCheck, installPendingOnQuit, respond, getState: () => state };
}

module.exports = {
  createUpdater,
  detectMode,
  fetchJson,
  fetchLatestRelease,
  AUTO_CHECK_DELAY_MS,
  MIN_PROGRESS_INTERVAL_MS,
};
