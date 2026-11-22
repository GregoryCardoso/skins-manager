'use strict';

// D284: a atualização nunca abre o assistente do NSIS. "Reiniciar agora" instala em silêncio e reabre o app;
// "Instalar ao fechar o app" instala em silêncio e não reabre. O backend continua parando antes de instalar.
const fs = require('fs');
const path = require('path');
const { createUpdater } = require('../src/updater');
const { makeDeps, flush, answer, downloadToReady } = require('./helpers/fakeUpdaterDeps');

const AVAILABLE = { isUpdateAvailable: true, updateInfo: { version: '1.1.0', releaseNotes: '<p>Novidades</p>' } };

describe('instalação silenciosa da atualização (D284)', () => {
  test('"Reiniciar agora": stopBackend antes, depois quitAndInstall(isSilent = true, isForceRunAfter = true)', async () => {
    const { deps, calls, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    answer(updater, 'restart');
    await flush();
    expect(calls.filter((c) => c[0] === 'stopBackend' || c[0] === 'quitAndInstall'))
      .toEqual([['stopBackend'], ['quitAndInstall', true, true]]);
  });

  test('"Instalar ao fechar o app": quitAndInstall(isSilent = true, isForceRunAfter = false)', async () => {
    const { deps, autoUpdater } = makeDeps();
    autoUpdater.checkForUpdates.mockResolvedValue(AVAILABLE);
    const updater = createUpdater(deps);
    await downloadToReady(updater);
    answer(updater, 'installOnQuit');
    expect(updater.installPendingOnQuit()).toBe(true);
    expect(autoUpdater.quitAndInstall.mock.calls).toEqual([[true, false]]);
  });

  test('nenhuma chamada do updater instala com o assistente (isSilent = false)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'updater.js'), 'utf8');
    const callsInSource = [...source.matchAll(/getAutoUpdater\(\)\.quitAndInstall\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(callsInSource).toEqual(['SILENT, RUN_AFTER_RESTART', 'SILENT, RUN_AFTER_QUIT']);
    expect(source).toMatch(/^const SILENT = true;/m);
    expect(source).toMatch(/^const RUN_AFTER_RESTART = true;/m);
    expect(source).toMatch(/^const RUN_AFTER_QUIT = false;/m);
  });

  test('a primeira instalação continua assistida e os dados continuam preservados (electron-builder.yml)', () => {
    const yml = fs.readFileSync(path.join(__dirname, '..', 'electron-builder.yml'), 'utf8');
    expect(yml).toMatch(/^\s+oneClick: false$/m);
    expect(yml).toMatch(/^\s+deleteAppDataOnUninstall: false$/m);
  });
});
