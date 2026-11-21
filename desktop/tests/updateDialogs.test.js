'use strict';

// D194: os diálogos nativos de atualização saíram (o modal fica na interface). Os de erro de inicialização, porta,
// crash e janela travada (D178) continuam.
jest.mock('electron', () => ({ dialog: { showMessageBox: jest.fn() } }));

const dialogs = require('../src/dialogs');
const { MESSAGES } = require('../src/i18n');

describe('diálogos nativos depois da v1.0.2', () => {
  test('as funções de atualização não existem mais', () => {
    for (const name of ['showUpdateAvailable', 'showUpdateReady', 'showUpdateError', 'showPortableUpdate', 'withNotes']) {
      expect(dialogs[name]).toBeUndefined();
    }
  });

  test('os diálogos que não são de atualização continuam exportados', () => {
    expect(Object.keys(dialogs).sort()).toEqual(
      ['showAlreadyOpen', 'showCrashLoop', 'showNoFreePort', 'showRenderGone', 'showStageMissing', 'showStartFailure'].sort()
    );
    for (const fn of Object.values(dialogs)) expect(typeof fn).toBe('function');
  });

  test('nenhuma chave update.* sobrou nos textos nativos', () => {
    for (const table of Object.values(MESSAGES)) {
      expect(Object.keys(table).filter((key) => key.startsWith('update.'))).toEqual([]);
    }
  });
});
