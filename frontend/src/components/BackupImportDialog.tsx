'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatFileSize } from '@/lib/backupFile';
import { formatDateTime, formatInteger } from '@/lib/format';
import { previewBackupImport, importBackup } from '@/services/api';
import type { BackupImportPreview, BackupImportResult } from '@/types/api';
import styles from './BackupImportDialog.module.css';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import Spinner from './ui/Spinner';

interface Props {
  file: File;
  onClose: () => void;
  // Escolher outro arquivo: fecha e reabre o seletor de arquivos de quem chamou.
  onPickAnother: () => void;
  // Importou: quem chamou invalida o cache, mostra o resultado e recarrega a janela.
  onImported: (result: BackupImportResult) => void;
}

// Importar um backup em passos (12.8): lê o arquivo e mostra o resumo (`POST /backup/import-preview`, nada é gravado); só depois de o
// usuário confirmar chama a importação de sempre. Um só Dialog em todos os passos, para o foco voltar ao botão que o abriu.
export default function BackupImportDialog({ file, onClose, onPickAnother, onImported }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<BackupImportPreview | null>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<unknown>(null);

  useEffect(() => {
    const controller = new AbortController();
    previewBackupImport(file, controller.signal)
      .then(setPreview)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setReadError(err);
      });
    return () => controller.abort();
  }, [file]);

  const confirm = () => {
    setImporting(true);
    setImportError(null);
    importBackup(file)
      .then((result) => onImported(result))
      .catch((err: unknown) => setImportError(err))
      .finally(() => setImporting(false));
  };

  const count = (key: 'items' | 'sales' | 'stores' | 'deposits' | 'withdrawals', value: number) =>
    tPlural(`settings.backup.preview.counts.${key}`, value, { count: formatInteger(value, locale) });

  let body;
  let footer;
  if (readError !== null) {
    body = <Banner tone="danger">{errorMessageFor(readError, tLoose, locale)}</Banner>;
    footer = (
      <>
        <Button onClick={onClose}>{t('common.close')}</Button>
        <Button variant="primary" onClick={onPickAnother}>{t('settings.backup.preview.pickAnother')}</Button>
      </>
    );
  } else if (preview === null) {
    body = (
      <div className={styles.reading}>
        <Spinner label={t('settings.backup.preview.reading')} />
        <span aria-hidden="true">{t('settings.backup.preview.reading')}</span>
      </div>
    );
    footer = <Button ref={cancelRef} onClick={onClose}>{t('common.cancel')}</Button>;
  } else {
    body = (
      <div className={styles.stack}>
        <p id={messageId} className={styles.text}>{t('settings.backup.confirmMessage', { file: file.name })}</p>
        <dl className={styles.facts}>
          <div>
            <dt>{t('settings.backup.preview.fileLine', { file: file.name, size: formatFileSize(preview.sizeBytes, locale) })}</dt>
          </div>
          <div>
            <dt>
              {preview.exportedAt
                ? t('settings.backup.preview.lastChange', { date: formatDateTime(preview.exportedAt, locale) })
                : t('settings.backup.preview.lastChangeUnknown')}
            </dt>
          </div>
          <div>
            <dt>{t('settings.backup.preview.schema', { version: preview.schemaVersion })}</dt>
            {preview.migrationsToApply.length > 0 && (
              <dd>{t('settings.backup.preview.willMigrate', { current: preview.currentSchemaVersion })}</dd>
            )}
          </div>
        </dl>
        <ul className={styles.counts}>
          <li>{count('items', preview.counts.items)}</li>
          <li>{count('sales', preview.counts.sales)}</li>
          <li>{count('stores', preview.counts.stores)}</li>
          <li>{count('deposits', preview.counts.deposits)}</li>
          <li>{count('withdrawals', preview.counts.withdrawals)}</li>
        </ul>
        {importError !== null && <Banner tone="danger">{errorMessageFor(importError, tLoose, locale)}</Banner>}
      </div>
    );
    footer = (
      <>
        <Button ref={cancelRef} onClick={onClose} disabled={importing}>{t('common.cancel')}</Button>
        <Button variant="danger" loading={importing} onClick={confirm}>{t('settings.backup.confirmButton')}</Button>
      </>
    );
  }

  return (
    <Dialog
      title={t('settings.backup.confirmTitle')}
      size="sm"
      busy={importing}
      onClose={onClose}
      role="alertdialog"
      describedBy={preview !== null ? messageId : undefined}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        cancelRef.current?.focus();
      }}
      footer={footer}
    >
      {body}
    </Dialog>
  );
}
