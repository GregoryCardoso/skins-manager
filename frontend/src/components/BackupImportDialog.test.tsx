// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { renderUi } from '@/test/renderUi';
import type { BackupImportPreview } from '@/types/api';

const api = vi.hoisted(() => ({ previewBackupImport: vi.fn(), importBackup: vi.fn() }));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));

import BackupImportDialog from './BackupImportDialog';

const PREVIEW: BackupImportPreview = {
  exportedAt: '2026-11-20T15:34:00.000Z', schemaVersion: 20, currentSchemaVersion: 26, migrationsToApply: [21, 22, 23, 24, 25, 26],
  appVersion: '2.0.0', sizeBytes: 524288, counts: { items: 312, stores: 4, sales: 140, deposits: 9, withdrawals: 1 },
};

const file = new File([new Uint8Array([1, 2, 3])], 'meu-backup.sqlite');

function renderDialog() {
  const handlers = { onClose: vi.fn(), onPickAnother: vi.fn(), onImported: vi.fn() };
  renderUi(<BackupImportDialog file={file} {...handlers} />);
  return handlers;
}

beforeEach(() => {
  api.previewBackupImport.mockReset();
  api.importBackup.mockReset();
});
afterEach(cleanup);

describe('BackupImportDialog', () => {
  test('lendo: mostra o carregando e chama só a prévia (nada é importado)', async () => {
    api.previewBackupImport.mockReturnValue(new Promise(() => {}));
    renderDialog();
    expect(screen.getAllByText('Reading the file…').length).toBeGreaterThan(0);
    expect(api.previewBackupImport).toHaveBeenCalledWith(file, expect.any(AbortSignal));
    expect(api.importBackup).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Replace my data' })).toBeNull();
  });

  test('com a prévia: arquivo, última alteração, versão, migrações e as contagens (plural)', async () => {
    api.previewBackupImport.mockResolvedValue(PREVIEW);
    renderDialog();
    expect(await screen.findByRole('button', { name: 'Replace my data' })).toBeInTheDocument();
    expect(screen.getByText('File: meu-backup.sqlite (512 KB)')).toBeInTheDocument();
    expect(screen.getByText(/Last change recorded in the file: /)).toBeInTheDocument();
    expect(screen.getByText('Data version: v20')).toBeInTheDocument();
    expect(screen.getByText('On import, your data will be updated to v26.')).toBeInTheDocument();
    for (const line of ['312 items', '140 sales', '4 stores', '9 deposits', '1 withdrawal']) expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.getByText(/This replaces ALL your current data/)).toBeInTheDocument();
  });

  test('versão atual: não fala em atualizar; sem data, diz que o arquivo não tem', async () => {
    api.previewBackupImport.mockResolvedValue({ ...PREVIEW, schemaVersion: 26, migrationsToApply: [], exportedAt: null });
    renderDialog();
    expect(await screen.findByText('The file has no change date.')).toBeInTheDocument();
    expect(screen.queryByText(/will be updated to/)).toBeNull();
  });

  test('confirmar chama a importação de hoje e avisa quem chamou com o resultado', async () => {
    api.previewBackupImport.mockResolvedValue(PREVIEW);
    const result = { fileVersion: 20, schemaVersion: 26, migrationsApplied: [21], preImportBackupFile: 'x.sqlite', counts: { items: 312, stores: 4 } };
    api.importBackup.mockResolvedValue(result);
    const { onImported } = renderDialog();
    await userEvent.click(await screen.findByRole('button', { name: 'Replace my data' }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(result));
    expect(api.importBackup).toHaveBeenCalledWith(file);
  });

  test('erro na importação aparece dentro do diálogo e o botão é liberado', async () => {
    api.previewBackupImport.mockResolvedValue(PREVIEW);
    api.importBackup.mockRejectedValue(new ApiRequestError('BACKUP_BUSY', 'x', 409));
    const { onImported } = renderDialog();
    await userEvent.click(await screen.findByRole('button', { name: 'Replace my data' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Replace my data' })).toBeEnabled();
  });

  test('erro de arquivo na prévia: Banner traduzido, sem botão de substituir, com "Escolher outro arquivo"', async () => {
    api.previewBackupImport.mockRejectedValue(new ApiRequestError('BACKUP_INVALID_FILE', 'x', 400));
    const { onPickAnother } = renderDialog();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Replace my data' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Choose another file' }));
    expect(onPickAnother).toHaveBeenCalled();
  });

  test('cancelar fecha sem importar', async () => {
    api.previewBackupImport.mockResolvedValue(PREVIEW);
    const { onClose } = renderDialog();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(api.importBackup).not.toHaveBeenCalled();
  });

  test('o foco inicial é o Cancelar (ação perigosa), não o botão de substituir', async () => {
    api.previewBackupImport.mockResolvedValue(PREVIEW);
    renderDialog();
    await screen.findByRole('button', { name: 'Replace my data' });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
