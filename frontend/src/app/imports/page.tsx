'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/badges';
import ImportEntriesList from '@/components/ImportEntriesList';
import UndoImportDialog from '@/components/UndoImportDialog';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDateTime } from '@/lib/format';
import { summaryLines } from '@/lib/importSummary';
import { queryKeys } from '@/lib/queryKeys';
import { getImportBatch, listImportBatches, listOpenImportEntries } from '@/services/api';
import type { ImportBatchSummary } from '@/types/api';
import styles from './page.module.css';

const PAGE_SIZE = 20;

function BatchDetails({ batchId }: { batchId: number }) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const query = useQuery({ queryKey: queryKeys.imports.batch(batchId), queryFn: ({ signal }) => getImportBatch(batchId, signal) });
  if (query.error !== null) return <p className={styles.error} role="alert">{errorMessageFor(query.error, tLoose, language)}</p>;
  if (!query.data) return <p className={styles.muted}>{t('common.loading')}</p>;
  if (query.data.entries.length === 0) return <p className={styles.muted}>{t('imports.page.noEntries')}</p>;
  return <ImportEntriesList entries={query.data.entries} />;
}

function BatchItem({ batch, onUndo }: { batch: ImportBatchSummary; onUndo: (id: number) => void }) {
  const t = useT();
  const tPlural = useTPlural();
  const tLoose = useTLoose();
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  const lines = summaryLines(batch.counts);
  return (
    <li className={styles.batch}>
      <div className={styles.batchHead}>
        <span className={styles.batchDate}>{formatDateTime(batch.finishedAt, language)}</span>
        <Badge>{t(batch.trigger === 'MANUAL' ? 'imports.page.manual' : 'imports.page.auto')}</Badge>
        {batch.fullScan && <Badge>{t('imports.page.fullScan')}</Badge>}
        {batch.status === 'UNDONE' && <Badge tone="warning">{t('imports.page.undone')}</Badge>}
        {batch.status === 'FAILED' && (
          <Badge tone="danger">{batch.errorCode ? tLoose(`errors.${batch.errorCode}`) : t('imports.page.failed')}</Badge>
        )}
        {batch.openEntriesCount > 0 && <Badge tone="warning">{tPlural('imports.page.pendingCount', batch.openEntriesCount)}</Badge>}
      </div>
      {batch.status !== 'FAILED' && (
        lines.length === 0
          ? <p className={styles.muted}>{t('imports.summary.nothingNew')}</p>
          : <ul className={styles.counts}>{lines.map((line) => <li key={line.key}>{tPlural(`imports.counts.${line.key}`, line.count)}</li>)}</ul>
      )}
      <div className={styles.batchActions}>
        {batch.status === 'DONE' && (
          <button type="button" className={styles.button} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? t('imports.page.hideDetails') : t('imports.page.showDetails')}
          </button>
        )}
        {batch.undoable && (
          <button type="button" className={styles.button} onClick={() => onUndo(batch.id)}>{t('imports.undo.button')}</button>
        )}
      </div>
      {open && <BatchDetails batchId={batch.id} />}
    </li>
  );
}

// Página "Importações" (9.2, D300): pendências abertas de todos os lotes e o histórico, com "Carregar mais".
export default function ImportsPage() {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const [undoId, setUndoId] = useState<number | null>(null);

  const entriesQuery = useQuery({ queryKey: queryKeys.imports.entries, queryFn: ({ signal }) => listOpenImportEntries(signal) });
  const batchesQuery = useInfiniteQuery({
    queryKey: queryKeys.imports.batches,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) => listImportBatches({ limit: PAGE_SIZE, before: pageParam }, signal),
    getNextPageParam: (last) => last.nextBefore,
  });

  const entries = entriesQuery.data?.entries ?? [];
  const batches = batchesQuery.data?.pages.flatMap((page) => page.batches) ?? [];

  return (
    <>
      <div className={styles.titleRow}>
        <h1>{t('imports.page.title')}</h1>
      </div>

      <section className={styles.section} aria-labelledby="imports-open-title">
        <h2 id="imports-open-title" className={styles.sectionTitle}>{t('imports.page.open')}</h2>
        {entriesQuery.error !== null && <p className={styles.error} role="alert">{errorMessageFor(entriesQuery.error, tLoose, language)}</p>}
        {entriesQuery.isPending && <p className={styles.muted}>{t('common.loading')}</p>}
        {entriesQuery.data && entries.length === 0 && <div className={styles.empty}>{t('imports.page.noOpen')}</div>}
        {entries.length > 0 && <ImportEntriesList entries={entries} />}
      </section>

      <section className={styles.section} aria-labelledby="imports-history-title">
        <h2 id="imports-history-title" className={styles.sectionTitle}>{t('imports.page.batches')}</h2>
        {batchesQuery.error !== null && <p className={styles.error} role="alert">{errorMessageFor(batchesQuery.error, tLoose, language)}</p>}
        {batchesQuery.isPending && <p className={styles.muted}>{t('common.loading')}</p>}
        {batchesQuery.data && batches.length === 0 && <div className={styles.empty}>{t('imports.page.noBatches')}</div>}
        {batches.length > 0 && (
          <ul className={styles.batches}>
            {batches.map((batch) => <BatchItem key={batch.id} batch={batch} onUndo={setUndoId} />)}
          </ul>
        )}
        {batchesQuery.hasNextPage && (
          <div>
            <button type="button" className={styles.button} onClick={() => batchesQuery.fetchNextPage()} disabled={batchesQuery.isFetchingNextPage}>
              {t('imports.page.loadMore')}
            </button>
          </div>
        )}
      </section>

      {undoId !== null && <UndoImportDialog batchId={undoId} onClose={() => setUndoId(null)} onFinished={() => setUndoId(null)} />}
    </>
  );
}
