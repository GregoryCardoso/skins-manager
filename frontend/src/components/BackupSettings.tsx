'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatInteger } from '@/lib/format';
import { saveBlobAs } from '@/lib/download';
import { BACKUP_MAX_BYTES, isBackupTooLarge } from '@/lib/backupFile';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateAfter } from '@/lib/queryInvalidation';
import { ApiRequestError, exportBackup, getBackupInfo, importBackup, openBackupsFolder } from '@/services/api';
import type { BackupImportResult, BackupInfo } from '@/types/api';
import ConfirmDialog from './ConfirmDialog';
import styles from './settings.module.css';

const RELOAD_DELAY_MS = 4000;

// Exportar e importar backup (D150, D151, D152).
export default function BackupSettings() {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const fileInput = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportedName, setExportedName] = useState<string | null>(null);
  const [exportError, setExportError] = useState<unknown>(null);
  const [file, setFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<unknown>(null);
  const [pickError, setPickError] = useState<unknown>(null);
  const [result, setResult] = useState<BackupImportResult | null>(null);
  const queryClient = useQueryClient();
  const infoQuery = useQuery({ queryKey: queryKeys.backupInfo.all, queryFn: ({ signal }) => getBackupInfo(signal) });
  const info: BackupInfo | null = infoQuery.data ?? null; // sem o caminho a tela continua útil (só não o mostra)
  const [folderError, setFolderError] = useState<unknown>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const onOpenFolder = () => {
    setFolderError(null);
    openBackupsFolder().catch((err: unknown) => setFolderError(err));
  };

  const onCopyPath = () => {
    if (!info) return;
    navigator.clipboard
      .writeText(info.backupsDir)
      .then(() => setCopyState('copied'))
      .catch(() => setCopyState('failed'));
  };

  useEffect(() => {
    if (result === null) return undefined;
    const timer = setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [result]);

  const onExport = () => {
    setExporting(true);
    setExportError(null);
    setExportedName(null);
    exportBackup()
      .then(({ blob, fileName }) => {
        saveBlobAs(blob, fileName);
        setExportedName(fileName);
      })
      .catch((err: unknown) => setExportError(err))
      .finally(() => setExporting(false));
  };

  const onPickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    setImportError(null);
    setResult(null);
    // T83: arquivo acima do limite nem é enviado.
    if (picked !== null && isBackupTooLarge(picked.size)) {
      setFile(null);
      setConfirming(false);
      setPickError(
        new ApiRequestError('PAYLOAD_TOO_LARGE', '', 413, { params: { maxBytes: BACKUP_MAX_BYTES } }),
      );
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setPickError(null);
    setFile(picked);
    setConfirming(picked !== null);
  };

  const closeConfirm = () => {
    setConfirming(false);
    setFile(null);
    setImportError(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const onConfirmImport = () => {
    if (!file) return;
    setImporting(true);
    setImportError(null);
    importBackup(file)
      .then((data) => {
        // O banco inteiro mudou: limpa o cache antes da recarga da janela (D259).
        invalidateAfter(queryClient, 'backup.import');
        setResult(data);
        setConfirming(false);
      })
      .catch((err: unknown) => setImportError(err))
      .finally(() => setImporting(false));
  };

  return (
    <section className={styles.card} aria-labelledby="settings-backup-title">
      <h2 id="settings-backup-title" className={styles.cardTitle}>{t('settings.backup.title')}</h2>
      <p className={styles.muted}>{t('settings.backup.intro')}</p>

      <p className={styles.warning}>{t('settings.backup.exportWarning')}</p>
      <div className={styles.row}>
        <button type="button" className={styles.button} onClick={onExport} disabled={exporting || importing}>
          {exporting ? t('settings.backup.exporting') : t('settings.backup.export')}
        </button>
      </div>
      {exportedName && <p className={styles.ok} role="status">{t('settings.backup.exported', { file: exportedName })}</p>}
      {exportError !== null && <p className={styles.error} role="alert">{errorMessageFor(exportError, tLoose, locale)}</p>}

      <div className={styles.row}>
        <input
          ref={fileInput}
          type="file"
          accept=".sqlite,.db,application/vnd.sqlite3,application/octet-stream"
          hidden
          onChange={onPickFile}
          data-testid="backup-file-input"
        />
        <button type="button" className={styles.button} onClick={() => fileInput.current?.click()} disabled={exporting || importing}>
          {importing ? t('settings.backup.importing') : t('settings.backup.import')}
        </button>
      </div>
      {pickError !== null && <p className={styles.error} role="alert">{errorMessageFor(pickError, tLoose, locale)}</p>}
      {result && (
        <div role="status">
          <p className={styles.ok}>
            {t('settings.backup.importDone', {
              items: tPlural('inventory.itemCount', result.counts.items, { count: formatInteger(result.counts.items, locale) }),
              stores: tPlural('stores.count', result.counts.stores, { count: formatInteger(result.counts.stores, locale) }),
              backup: result.preImportBackupFile,
            })}
          </p>
          {result.migrationsApplied.length > 0 && (
            <p className={styles.muted}>{t('settings.backup.migrated', { from: result.fileVersion, to: result.schemaVersion })}</p>
          )}
          <p className={styles.muted}>{t('settings.backup.reloading')}</p>
          <button type="button" className={styles.button} onClick={() => window.location.reload()}>
            {t('settings.backup.reloadNow')}
          </button>
        </div>
      )}

      <p className={styles.muted}>{t('settings.backup.retention')}</p>
      {info && (
        <div>
          <p className={styles.muted}>
            {t('settings.backup.folderLabel')}: <code data-testid="backups-dir">{info.backupsDir}</code>
          </p>
          <div className={styles.row}>
            {info.canOpenFolder && (
              <button type="button" className={styles.button} onClick={onOpenFolder}>
                {t('settings.backup.openFolder')}
              </button>
            )}
            <button type="button" className={styles.button} onClick={onCopyPath}>
              {t('settings.backup.copyPath')}
            </button>
          </div>
          {copyState === 'copied' && <p className={styles.ok} role="status">{t('settings.backup.pathCopied')}</p>}
          {copyState === 'failed' && <p className={styles.error} role="alert">{t('settings.backup.copyFailed')}</p>}
          {folderError !== null && <p className={styles.error} role="alert">{errorMessageFor(folderError, tLoose, locale)}</p>}
        </div>
      )}

      {confirming && file && (
        <ConfirmDialog
          title={t('settings.backup.confirmTitle')}
          message={t('settings.backup.confirmMessage', { file: file.name })}
          confirmLabel={t('settings.backup.confirmButton')}
          danger
          busy={importing}
          error={importError !== null ? errorMessageFor(importError, tLoose, locale) : null}
          onConfirm={onConfirmImport}
          onCancel={closeConfirm}
        />
      )}
    </section>
  );
}
