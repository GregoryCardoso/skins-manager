'use client';

import { useQuery } from '@tanstack/react-query';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDateTime } from '@/lib/format';
import { summaryLines } from '@/lib/importSummary';
import { queryKeys } from '@/lib/queryKeys';
import { getImportBatch } from '@/services/api';
import type { ImportBatchSummary } from '@/types/api';
import styles from './ImportBatchList.module.css';
import ImportEntriesList from './ImportEntriesList';
import Badge from './ui/Badge';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Disclosure from './ui/Disclosure';
import Spinner from './ui/Spinner';

function BatchDetails({ batchId }: { batchId: number }) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const query = useQuery({ queryKey: queryKeys.imports.batch(batchId), queryFn: ({ signal }) => getImportBatch(batchId, signal) });
  if (query.error !== null) return <Banner tone="danger" onRetry={() => void query.refetch()} retrying={query.isFetching}>{errorMessageFor(query.error, tLoose, locale)}</Banner>;
  if (!query.data) return <Spinner label={t('common.loading')} />;
  if (query.data.entries.length === 0) return <p className={styles.muted}>{t('imports.page.noEntries')}</p>;
  return <ImportEntriesList entries={query.data.entries} />;
}

function BatchItem({ batch, onUndo }: { batch: ImportBatchSummary; onUndo: (id: number) => void }) {
  const t = useT();
  const tPlural = useTPlural();
  const tLoose = useTLoose();
  const locale = useLocale();
  const lines = summaryLines(batch.counts);
  return (
    <li className={styles.batch}>
      <div className={styles.head}>
        <span className={styles.date}>{formatDateTime(batch.finishedAt, locale)}</span>
        <Badge tone="neutral">{t(batch.trigger === 'MANUAL' ? 'imports.page.manual' : 'imports.page.auto')}</Badge>
        {batch.fullScan && <Badge tone="neutral">{t('imports.page.fullScan')}</Badge>}
        {batch.status === 'UNDONE' && <Badge tone="stuck">{t('imports.page.undone')}</Badge>}
        {batch.cutoffChange && <Badge tone="info">{t('imports.cutoffChange.badge')}</Badge>}
        {batch.status === 'FAILED' && (
          <Badge tone="loss">{batch.errorCode ? tLoose(`errors.${batch.errorCode}`) : t('imports.page.failed')}</Badge>
        )}
        {batch.openEntriesCount > 0 && <Badge tone="pending">{tPlural('imports.page.pendingCount', batch.openEntriesCount)}</Badge>}
      </div>
      {batch.status !== 'FAILED' && (
        lines.length === 0
          ? <p className={styles.muted}>{t('imports.summary.nothingNew')}</p>
          : <ul className={styles.counts}>{lines.map((line) => <li key={line.key}>{tPlural(`imports.counts.${line.key}`, line.count)}</li>)}</ul>
      )}
      {batch.cutoffChange && (
        <p className={styles.muted}>
          {t('imports.cutoffChange.history', {
            from: formatDateTime(batch.cutoffChange.from, locale),
            to: batch.cutoffChange.to ? formatDateTime(batch.cutoffChange.to, locale) : '',
          })}
        </p>
      )}
      {batch.status === 'DONE' && (
        <Disclosure label={t('imports.page.showDetails')}>
          <BatchDetails batchId={batch.id} />
        </Disclosure>
      )}
      {batch.undoable && (
        <div className={styles.actions}>
          <Button size="sm" variant="danger" onClick={() => onUndo(batch.id)}>{t('imports.undo.button')}</Button>
        </div>
      )}
    </li>
  );
}

// Histórico de lotes da página Importações (12.9): cada lote com Badges, "Ver detalhes" (Disclosure) e "Desfazer".
export default function ImportBatchList({ batches, onUndo }: { batches: readonly ImportBatchSummary[]; onUndo: (id: number) => void }) {
  return (
    <ul className={styles.batches}>
      {batches.map((batch) => <BatchItem key={batch.id} batch={batch} onUndo={onUndo} />)}
    </ul>
  );
}
