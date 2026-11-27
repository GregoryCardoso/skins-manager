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
import { ApiRequestError, exportBackup, getBackupInfo, openBackupsFolder } from '@/services/api';
import type { BackupImportResult, BackupInfo } from '@/types/api';
import BackupImportDialog from './BackupImportDialog';
import styles from './BackupSettings.module.css';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Panel from './ui/Panel';
import { useToast } from './ui/Toast';

const RELOAD_DELAY_MS = 4000;

// Exportar e importar backup (D150, D151, D152). A importação passa por uma prévia do arquivo antes de substituir os dados (12.8).
export default function BackupSettings() {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pickError, setPickError] = useState<unknown>(null);
  const [result, setResult] = useState<BackupImportResult | null>(null);
  const queryClient = useQueryClient();
  const infoQuery = useQuery({ queryKey: queryKeys.backupInfo.all, queryFn: ({ signal }) => getBackupInfo(signal) });
  const info: BackupInfo | null = infoQuery.data ?? null; // sem o caminho a tela continua útil (só não o mostra)
  const [folderError, setFolderError] = useState<unknown>(null);

  const onOpenFolder = () => {
    setFolderError(null);
    openBackupsFolder().catch((err: unknown) => setFolderError(err));
  };

  const onCopyPath = () => {
    if (!info) return;
    navigator.clipboard
      .writeText(info.backupsDir)
      .then(() => toast.show({ tone: 'success', message: t('settings.backup.pathCopied') }))
      .catch(() => toast.show({ tone: 'danger', message: t('settings.backup.copyFailed') }));
  };

  useEffect(() => {
    if (result === null) return undefined;
    const timer = setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [result]);

  const onExport = () => {
    setExporting(true);
    setExportError(null);
    exportBackup()
      .then(({ blob, fileName }) => {
        saveBlobAs(blob, fileName);
        toast.show({ tone: 'success', message: t('settings.backup.exported', { file: fileName }) });
      })
      .catch((err: unknown) => setExportError(err))
      .finally(() => setExporting(false));
  };

  const onPickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    setResult(null);
    // Arquivo acima do limite nem é enviado (T83): o erro aparece sem abrir a prévia.
    if (picked !== null && isBackupTooLarge(picked.size)) {
      setFile(null);
      setPickError(new ApiRequestError('PAYLOAD_TOO_LARGE', '', 413, { params: { maxBytes: BACKUP_MAX_BYTES } }));
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setPickError(null);
    setFile(picked);
  };

  const closeImport = () => {
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
    // O diálogo devolve o foco a quem o abriu; garantimos o botão mesmo se ele já tinha perdido o foco.
    requestAnimationFrame(() => importButton.current?.focus());
  };

  const pickAnother = () => {
    setFile(null);
    if (fileInput.current) {
      fileInput.current.value = '';
      fileInput.current.click();
    }
  };

  const onImported = (data: BackupImportResult) => {
    // O banco inteiro mudou: limpa o cache antes da recarga da janela (D259).
    invalidateAfter(queryClient, 'backup.import');
    setResult(data);
    setFile(null);
  };

  return (
    <Panel title={t('settings.backup.title')} hint={t('settings.backup.intro')}>
      <div className={styles.stack}>
        <Banner tone="warning" announce={false}>{t('settings.backup.exportWarning')}</Banner>
        <div className={styles.row}>
          <Button variant="primary" icon="arrowDown" loading={exporting} disabled={file !== null} onClick={onExport}>
            {exporting ? t('settings.backup.exporting') : t('settings.backup.export')}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".sqlite,.db,application/vnd.sqlite3,application/octet-stream"
            hidden
            onChange={onPickFile}
            data-testid="backup-file-input"
          />
          <Button ref={importButton} icon="arrowUp" disabled={exporting} onClick={() => fileInput.current?.click()}>
            {t('settings.backup.import')}
          </Button>
        </div>
        {exportError !== null && <Banner tone="danger">{errorMessageFor(exportError, tLoose, locale)}</Banner>}
        {pickError !== null && <Banner tone="danger">{errorMessageFor(pickError, tLoose, locale)}</Banner>}

        {result && (
          <Banner tone="success" action={{ label: t('settings.backup.reloadNow'), onClick: () => window.location.reload() }}>
            <p className={styles.line}>
              {t('settings.backup.importDone', {
                items: tPlural('inventory.itemCount', result.counts.items, { count: formatInteger(result.counts.items, locale) }),
                stores: tPlural('stores.count', result.counts.stores, { count: formatInteger(result.counts.stores, locale) }),
                backup: result.preImportBackupFile,
              })}
            </p>
            {result.migrationsApplied.length > 0 && (
              <p className={styles.line}>{t('settings.backup.migrated', { from: result.fileVersion, to: result.schemaVersion })}</p>
            )}
            <p className={styles.line}>{t('settings.backup.reloading')}</p>
          </Banner>
        )}

        <p className={styles.muted}>{t('settings.backup.retention')}</p>
        {info && (
          <div className={styles.folder}>
            <p className={styles.muted}>
              {t('settings.backup.folderLabel')}: <code className={styles.path} data-testid="backups-dir">{info.backupsDir}</code>
            </p>
            <div className={styles.row}>
              {info.canOpenFolder && (
                <Button icon="externalLink" onClick={onOpenFolder}>{t('settings.backup.openFolder')}</Button>
              )}
              <Button onClick={onCopyPath}>{t('settings.backup.copyPath')}</Button>
            </div>
            {folderError !== null && <Banner tone="danger">{errorMessageFor(folderError, tLoose, locale)}</Banner>}
          </div>
        )}
      </div>

      {file && <BackupImportDialog file={file} onClose={closeImport} onPickAnother={pickAnother} onImported={onImported} />}
    </Panel>
  );
}
