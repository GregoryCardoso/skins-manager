'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { getUndoPreview, undoImportBatch } from '@/services/api';
import type { UndoPreviewIssue } from '@/types/api';
import styles from './imports/importModals.module.css';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Checkbox from './ui/Checkbox';
import Dialog from './ui/Dialog';
import Spinner from './ui/Spinner';

interface Props {
  batchId: number;
  // Cancelar (ou fechar sem desfazer).
  onClose: () => void;
  // Fechar depois de desfeito.
  onFinished: () => void;
}

function IssueList({ issues }: { issues: UndoPreviewIssue[] }) {
  const tLoose = useTLoose();
  return (
    <ul className={styles.list}>
      {issues.map((issue) => {
        const key = `imports.undo.${issue.code}`;
        const label = tLoose(key);
        return <li key={`${issue.code}-${issue.entryId ?? issue.itemId}`}>{issue.name ?? ''}{label !== key ? ` — ${label}` : ''}</li>;
      })}
    </ul>
  );
}

// Desfazer a última importação (9.2, D302; 12.9): confirmação em alertdialog com o que será desfeito, os bloqueios em aviso de perigo
// e os avisos com "Entendi" obrigatório. O botão de desfazer só existe quando é possível e o foco inicial fica em Cancelar.
export default function UndoImportDialog({ batchId, onClose, onFinished }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const previewQuery = useQuery({
    queryKey: queryKeys.imports.undoPreview(batchId),
    queryFn: ({ signal }) => getUndoPreview(batchId, signal),
    gcTime: 0,
  });
  const preview = previewQuery.data ?? null;
  const blocked = preview !== null && preview.blockers.length > 0;
  const needsAck = preview !== null && preview.warnings.length > 0;

  const confirm = () => {
    setBusy(true);
    setError(null);
    undoImportBatch(batchId, ack)
      .then(() => {
        setDone(true);
        return invalidate('import.undo');
      })
      .catch((err: unknown) => setError(err))
      .finally(() => setBusy(false));
  };

  if (done) {
    return (
      <Dialog
        title={t('imports.undo.title')}
        size="sm"
        onClose={onFinished}
        footer={<Button variant="primary" onClick={onFinished}>{t('common.close')}</Button>}
      >
        <Banner tone="success">{t('imports.undo.done')}</Banner>
      </Dialog>
    );
  }

  const canUndo = preview !== null && preview.undoable && !blocked;

  return (
    <Dialog
      title={t('imports.undo.title')}
      size="sm"
      role="alertdialog"
      onClose={onClose}
      busy={busy}
      onOpenAutoFocus={(event) => {
        // O foco inicial fica em "Cancelar" (ação destrutiva): o primeiro botão do rodapé.
        event.preventDefault();
        cancelRef.current?.focus();
      }}
      footer={(
        <>
          <Button ref={cancelRef} onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          {canUndo && (
            <Button variant="danger" onClick={confirm} loading={busy} disabled={needsAck && !ack}>
              {busy ? t('common.saving') : t('imports.undo.button')}
            </Button>
          )}
        </>
      )}
    >
      <div className={styles.stack}>
        {previewQuery.isPending && <Spinner label={t('common.loading')} />}
        {previewQuery.error !== null && <Banner tone="danger">{errorMessageFor(previewQuery.error, tLoose, locale)}</Banner>}
        {preview !== null && !preview.undoable && preview.reason !== null && (
          <Banner tone="info">{t(`imports.undo.reasons.${preview.reason}`)}</Banner>
        )}
        {preview !== null && preview.reason === null && (
          <>
            {blocked ? (
              <Banner tone="danger">
                <p>{t('imports.undo.blocked')}</p>
                <IssueList issues={preview.blockers} />
              </Banner>
            ) : (
              <div className={styles.stack}>
                {preview.counts.itemsToDelete > 0 && <p>{tPlural('imports.undo.bodyItems', preview.counts.itemsToDelete)}</p>}
                {preview.counts.linksToRemove > 0 && <p>{tPlural('imports.undo.bodyLinks', preview.counts.linksToRemove)}</p>}
                {(preview.counts.salesToUndo ?? 0) > 0 && <p>{tPlural('imports.undo.bodySales', preview.counts.salesToUndo)}</p>}
                {(preview.counts.transfersToDelete ?? 0) > 0 && <p>{tPlural('imports.undo.bodyTransfers', preview.counts.transfersToDelete ?? 0)}</p>}
              </div>
            )}
            {!blocked && needsAck && (
              <Banner tone="warning">
                <IssueList issues={preview.warnings} />
                <Checkbox label={t('imports.undo.warningsAck')} checked={ack} onChange={setAck} disabled={busy} />
              </Banner>
            )}
          </>
        )}
        {error !== null && <Banner tone="danger">{errorMessageFor(error, tLoose, locale)}</Banner>}
      </div>
    </Dialog>
  );
}
