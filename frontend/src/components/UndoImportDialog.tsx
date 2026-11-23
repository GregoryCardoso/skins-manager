'use client';

import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { getUndoPreview, undoImportBatch } from '@/services/api';
import type { UndoPreviewIssue } from '@/types/api';
import forms from './forms.module.css';
import Modal from './Modal';

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
    <ul>
      {issues.map((issue) => {
        const key = `imports.undo.${issue.code}`;
        const label = tLoose(key);
        return <li key={`${issue.code}-${issue.entryId ?? issue.itemId}`}>{issue.name ?? ''}{label !== key ? ` — ${label}` : ''}</li>;
      })}
    </ul>
  );
}

// Desfazer a última importação (9.2, D302): mostra os bloqueios, os avisos (com "Entendi" obrigatório) e o que será desfeito.
export default function UndoImportDialog({ batchId, onClose, onFinished }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const language = useLanguage();
  const invalidate = useInvalidate();
  const ackId = useId();
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
      <Modal title={t('imports.undo.title')} onClose={onFinished}>
        <div className={forms.form}>
          <p role="status">{t('imports.undo.done')}</p>
          <div className={forms.actions}>
            <button type="button" className={`${forms.button} ${forms.primary}`} onClick={onFinished} autoFocus>{t('common.close')}</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t('imports.undo.title')} onClose={onClose} busy={busy}>
      <div className={forms.form}>
        {previewQuery.isPending && <p>{t('common.loading')}</p>}
        {previewQuery.error !== null && <div className={forms.topError} role="alert">{errorMessageFor(previewQuery.error, tLoose, language)}</div>}
        {preview !== null && !preview.undoable && preview.reason !== null && (
          <p role="status">{t(`imports.undo.reasons.${preview.reason}`)}</p>
        )}
        {preview !== null && preview.reason === null && (
          <>
            {blocked ? (
              <div className={forms.topError} role="alert">
                <p>{t('imports.undo.blocked')}</p>
                <IssueList issues={preview.blockers} />
              </div>
            ) : (
              <>
                {preview.counts.itemsToDelete > 0 && <p>{tPlural('imports.undo.bodyItems', preview.counts.itemsToDelete)}</p>}
                {preview.counts.linksToRemove > 0 && <p>{tPlural('imports.undo.bodyLinks', preview.counts.linksToRemove)}</p>}
                {(preview.counts.salesToUndo ?? 0) > 0 && <p>{tPlural('imports.undo.bodySales', preview.counts.salesToUndo)}</p>}
              </>
            )}
            {!blocked && needsAck && (
              <div className={forms.note}>
                <IssueList issues={preview.warnings} />
                <label htmlFor={ackId} className={forms.row}>
                  <input id={ackId} type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} />
                  <span>{t('imports.undo.warningsAck')}</span>
                </label>
              </div>
            )}
          </>
        )}
        {error !== null && <div className={forms.topError} role="alert">{errorMessageFor(error, tLoose, language)}</div>}
        <div className={forms.actions}>
          <button type="button" className={forms.button} onClick={onClose} disabled={busy} autoFocus>{t('common.cancel')}</button>
          {preview !== null && preview.undoable && !blocked && (
            <button type="button" className={`${forms.button} ${forms.danger}`} onClick={confirm} disabled={busy || (needsAck && !ack)}>
              {busy ? t('common.saving') : t('imports.undo.button')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
