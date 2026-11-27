// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { renderUi } from '@/test/renderUi';
import type { BackupImportPreview } from '@/types/api';

const api = vi.hoisted(() => ({
  getBackupInfo: vi.fn(),
  previewBackupImport: vi.fn(),
  importBackup: vi.fn(),
  exportBackup: vi.fn(),
  openBackupsFolder: vi.fn(),
}));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));

import BackupSettings from './BackupSettings';

const PREVIEW: BackupImportPreview = {
  exportedAt: '2026-11-20T15:34:00.000Z', schemaVersion: 26, currentSchemaVersion: 26, migrationsToApply: [],
  appVersion: '2.0.0', sizeBytes: 2048, counts: { items: 3, stores: 4, sales: 1, deposits: 0, withdrawals: 0 },
};

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderUi(<BackupSettings />, { client, withToast: true });
}

const pickFile = async (file = new File([new Uint8Array([1, 2, 3])], 'meu-backup.sqlite')) => {
  await userEvent.upload(screen.getByTestId('backup-file-input'), file);
  return file;
};
const importButton = () => screen.getByRole('button', { name: 'Import backup' });

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getBackupInfo.mockResolvedValue({ backupsDir: 'C:\\dados\\backups', canOpenFolder: true });
  api.previewBackupImport.mockResolvedValue(PREVIEW);
});
afterEach(cleanup);

describe('BackupSettings: importar em passos (prévia, confirmação, importação)', () => {
  test('escolher o arquivo só chama a prévia: nada é importado antes de confirmar', async () => {
    renderSettings();
    await pickFile();
    await screen.findByRole('button', { name: 'Replace my data' });
    expect(api.previewBackupImport).toHaveBeenCalledTimes(1);
    expect(api.importBackup).not.toHaveBeenCalled();
  });

  test('cancelar na leitura (prévia ainda carregando) fecha, não importa e devolve o foco ao botão', async () => {
    api.previewBackupImport.mockReturnValue(new Promise(() => {}));
    renderSettings();
    await pickFile();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.importBackup).not.toHaveBeenCalled();
    await waitFor(() => expect(importButton()).toHaveFocus());
  });

  test('cancelar na confirmação fecha, não importa, zera o seletor e devolve o foco ao botão', async () => {
    renderSettings();
    await pickFile();
    await screen.findByRole('button', { name: 'Replace my data' });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.importBackup).not.toHaveBeenCalled();
    expect((screen.getByTestId('backup-file-input') as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(importButton()).toHaveFocus());
  });

  test('Esc na confirmação também fecha e devolve o foco', async () => {
    renderSettings();
    await pickFile();
    await screen.findByRole('button', { name: 'Replace my data' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.importBackup).not.toHaveBeenCalled();
    await waitFor(() => expect(importButton()).toHaveFocus());
  });

  test('arquivo recusado na prévia: Fechar devolve o foco; nada foi importado', async () => {
    api.previewBackupImport.mockRejectedValue(new ApiRequestError('BACKUP_INVALID_FILE', 'x', 400));
    renderSettings();
    await pickFile();
    await screen.findByRole('button', { name: 'Choose another file' });
    expect(screen.queryByRole('button', { name: 'Replace my data' })).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(importButton()).toHaveFocus());
    expect(api.importBackup).not.toHaveBeenCalled();
  });

  test('confirmar chama a importação uma vez e mostra o resultado', async () => {
    api.importBackup.mockResolvedValue({
      fileVersion: 26, schemaVersion: 26, migrationsApplied: [], preImportBackupFile: 'pre-import.sqlite',
      counts: { items: 3, stores: 4, sales: 1, deposits: 0, withdrawals: 0 },
    });
    renderSettings();
    const file = await pickFile();
    await userEvent.click(await screen.findByRole('button', { name: 'Replace my data' }));
    await waitFor(() => expect(api.importBackup).toHaveBeenCalledWith(file));
    expect(api.importBackup).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(await screen.findByText(/pre-import\.sqlite/)).toBeInTheDocument();
  });

  test('arquivo acima do limite: erro na tela, sem prévia e sem diálogo', async () => {
    renderSettings();
    const big = new File([new Uint8Array([1])], 'enorme.sqlite');
    Object.defineProperty(big, 'size', { value: 101 * 1024 * 1024 });
    await pickFile(big);
    expect(api.previewBackupImport).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(await screen.findByText(/too large|larger|exceeds|limit/i)).toBeInTheDocument();
  });

  test('"Choose another file" fecha o diálogo e reabre o seletor', async () => {
    api.previewBackupImport.mockRejectedValue(new ApiRequestError('BACKUP_CORRUPTED', 'x', 400));
    renderSettings();
    const input = screen.getByTestId('backup-file-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    await pickFile();
    await userEvent.click(await screen.findByRole('button', { name: 'Choose another file' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(click).toHaveBeenCalled();
  });
});
