'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDateTime } from '@/lib/format';
import { isNothingNew, summaryLines } from '@/lib/importSummary';
import type { ImportBatchView } from '@/types/api';
import forms from './forms.module.css';
import ImportEntriesList from './ImportEntriesList';
import Modal from './Modal';
import UndoImportDialog from './UndoImportDialog';

interface Props {
  batch: ImportBatchView;
  onClose: () => void;
}

// Resumo logo depois da importação manual (9.2, D300): contagens, entradas por grupo e as ações "Desfazer importação" e "Ver detalhes".
export default function ImportSummaryModal({ batch, onClose }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const [undoOpen, setUndoOpen] = useState(false);
  const lines = summaryLines(batch.counts);
  const nothingNew = isNothingNew(batch.counts);

  return (
    <>
      <Modal title={t('imports.summary.title')} onClose={onClose} wide>
        <div className={forms.form}>
          <p className={forms.muted}>{formatDateTime(batch.finishedAt, locale)}</p>
          {batch.cutoffChange && (
            <p role="status">
              {t('imports.cutoffChange.history', {
                from: formatDateTime(batch.cutoffChange.from, locale),
                to: batch.cutoffChange.to ? formatDateTime(batch.cutoffChange.to, locale) : '',
              })}
            </p>
          )}
          {batch.transactionsCutoffChange && (
            <p role="status">{t('imports.transferCutoff.history')}</p>
          )}
          {nothingNew && <p role="status">{t('imports.summary.nothingNew')}</p>}
          {lines.length > 0 && (
            <ul>
              {lines.map((line) => <li key={line.key}>{tPlural(`imports.counts.${line.key}`, line.count)}</li>)}
            </ul>
          )}
          {batch.counts.beforeCutoff > 0 && (
            <p className={forms.hint}>
              {t('imports.cutoffChange.olderHint')} <Link href="/imports/" onClick={onClose}>{t('imports.cutoffChange.link')}</Link>
            </p>
          )}
          {batch.warnings.map((warning) => {
            const key = `imports.warnings.${warning}`;
            const text = tLoose(key);
            return <p key={warning} className={forms.note} role="status">{text !== key ? text : warning}</p>;
          })}
          <ImportEntriesList entries={batch.entries} onNavigate={onClose} />
          <div className={forms.actions}>
            {batch.undoable && (
              <button type="button" className={forms.button} onClick={() => setUndoOpen(true)}>{t('imports.undo.button')}</button>
            )}
            <Link href="/imports/" className={forms.button} onClick={onClose}>{t('imports.summary.details')}</Link>
            <button type="button" className={`${forms.button} ${forms.primary}`} onClick={onClose} autoFocus>{t('common.close')}</button>
          </div>
        </div>
      </Modal>
      {undoOpen && (
        <UndoImportDialog
          batchId={batch.id}
          onClose={() => setUndoOpen(false)}
          onFinished={() => {
            setUndoOpen(false);
            onClose();
          }}
        />
      )}
    </>
  );
}
