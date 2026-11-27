'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDateTime } from '@/lib/format';
import { isNothingNew, summaryLines } from '@/lib/importSummary';
import type { ImportBatchView } from '@/types/api';
import ImportEntriesList from './ImportEntriesList';
import styles from './imports/importModals.module.css';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import Icon from './ui/Icon';
import UndoImportDialog from './UndoImportDialog';

interface Props {
  batch: ImportBatchView;
  onClose: () => void;
}

// Resumo logo depois da importação manual (9.2, D300; 12.9): contagens como lista com ícones, entradas por grupo e as ações
// "Desfazer importação" e "Ver detalhes".
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
      <Dialog
        title={t('imports.summary.title')}
        description={formatDateTime(batch.finishedAt, locale)}
        size="lg"
        onClose={onClose}
        footer={(
          <>
            {batch.undoable && <Button onClick={() => setUndoOpen(true)}>{t('imports.undo.button')}</Button>}
            <Link href="/imports/" className={styles.linkButton} onClick={onClose}>{t('imports.summary.details')}</Link>
            <Button variant="primary" onClick={onClose}>{t('common.close')}</Button>
          </>
        )}
      >
        <div className={styles.form}>
          {batch.cutoffChange && (
            <Banner tone="info">
              {t('imports.cutoffChange.history', {
                from: formatDateTime(batch.cutoffChange.from, locale),
                to: batch.cutoffChange.to ? formatDateTime(batch.cutoffChange.to, locale) : '',
              })}
            </Banner>
          )}
          {batch.transactionsCutoffChange && <Banner tone="info">{t('imports.transferCutoff.history')}</Banner>}
          {nothingNew && <Banner tone="success">{t('imports.summary.nothingNew')}</Banner>}
          {lines.length > 0 && (
            <ul className={styles.iconList}>
              {lines.map((line) => (
                <li key={line.key}>
                  <Icon name="circleCheck" size={16} />
                  <span>{tPlural(`imports.counts.${line.key}`, line.count)}</span>
                </li>
              ))}
            </ul>
          )}
          {batch.counts.beforeCutoff > 0 && (
            <p className={styles.help}>
              {t('imports.cutoffChange.olderHint')} <Link href="/imports/#cutoff" onClick={onClose}>{t('imports.cutoffChange.link')}</Link>
            </p>
          )}
          {batch.warnings.map((warning) => {
            const key = `imports.warnings.${warning}`;
            const text = tLoose(key);
            return <Banner key={warning} tone="warning">{text !== key ? text : warning}</Banner>;
          })}
          <ImportEntriesList entries={batch.entries} onNavigate={onClose} />
        </div>
      </Dialog>
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
