'use strict';

// Diálogos de atualização com `electron.dialog` simulado: o botão de cancelar (fechar com Esc/X) é sempre o último.
const mockShow = jest.fn();
jest.mock('electron', () => ({ dialog: { showMessageBox: (...args) => mockShow(...args) } }));

const dialogs = require('../src/dialogs');

beforeEach(() => mockShow.mockReset());

describe('diálogos de atualização', () => {
  test('primeira confirmação: botões "baixar" e "agora não"; fechar (cancelId) = later', async () => {
    mockShow.mockResolvedValue({ response: 1 });
    const answer = await dialogs.showUpdateAvailable({ language: 'pt-BR', version: '1.1.0', current: '1.0.0', notes: 'n' });
    expect(answer).toBe('later');
    const options = mockShow.mock.calls[0][0];
    expect(options.buttons).toHaveLength(2);
    expect(options.cancelId).toBe(1);
    expect(options.defaultId).toBe(0);
    expect(options.message).toMatch(/1\.1\.0/);
    expect(options.message).toMatch(/1\.0\.0/);
    expect(options.detail).toMatch(/n/);
  });

  test('primeira confirmação: botão 0 = download', async () => {
    mockShow.mockResolvedValue({ response: 0 });
    expect(await dialogs.showUpdateAvailable({ language: 'en', version: '1.1.0', current: '1.0.0', notes: '' })).toBe('download');
  });

  test('segunda confirmação: botão 0 = restart; fechar (cancelId) = on-quit', async () => {
    mockShow.mockResolvedValue({ response: 0 });
    expect(await dialogs.showUpdateReady({ language: 'pt-BR', version: '1.1.0' })).toBe('restart');
    mockShow.mockResolvedValue({ response: 1 });
    expect(await dialogs.showUpdateReady({ language: 'pt-BR', version: '1.1.0' })).toBe('on-quit');
    expect(mockShow.mock.calls[1][0].cancelId).toBe(1);
  });

  test('portátil: open / close', async () => {
    mockShow.mockResolvedValue({ response: 0 });
    expect(await dialogs.showPortableUpdate({ language: 'pt-BR', version: '1.1.0', current: '1.0.0', notes: '' })).toBe('open');
    mockShow.mockResolvedValue({ response: 1 });
    expect(await dialogs.showPortableUpdate({ language: 'pt-BR', version: '1.1.0', current: '1.0.0', notes: '' })).toBe('close');
  });

  test('janela pai é usada quando existe', async () => {
    mockShow.mockResolvedValue({ response: 0 });
    const parent = {};
    await dialogs.showUpdateReady({ parent, language: 'pt-BR', version: '1.1.0' });
    expect(mockShow.mock.calls[0][0]).toBe(parent);
  });
});
