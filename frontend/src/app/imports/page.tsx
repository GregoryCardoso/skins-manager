'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/badges';
import ImportEntriesList from '@/components/ImportEntriesList';
import { useCsfloatImport } from '@/components/useCsfloatImport';
import UndoImportDialog from '@/components/UndoImportDialog';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDateTime } from '@/lib/format';
import { summaryLines } from '@/lib/importSummary';
import { queryKeys } from '@/lib/queryKeys';
import { getImportBatch, listIgnoredImportEntries, listImportBatches, listOpenImportEntries } from '@/services/api';
import type { ImportBatchSummary } from '@/types/api';
import styles from './page.module.css';

const PAGE_SIZE = 20;

function BatchDetails({ batchId }: { batchId: number }) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const query = useQuery({ queryKey: queryKeys.imports.batch(batchId), queryFn: ({ signal }) => getImportBatch(batchId, signal) });
  if (query.error !== null) return <p className={styles.error} role="alert">{errorMessageFor(query.error, tLoose, locale)}</p>;
  if (!query.data) return <p className={styles.muted}>{t('common.loading')}</p>;
  if (query.data.entries.length === 0) return <p className={styles.muted}>{t('imports.page.noEntries')}</p>;
  return <ImportEntriesList entries={query.data.entries} />;
}

function BatchItem({ batch, onUndo }: { batch: ImportBatchSummary; onUndo: (id: number) => void }) {
  const t = useT();
  const tPlural = useTPlural();
  const tLoose = useTLoose();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const lines = summaryLines(batch.counts);
  return (
    <li className={styles.batch}>
      <div className={styles.batchHead}>
        <span className={styles.batchDate}>{formatDateTime(batch.finishedAt, locale)}</span>
        <Badge>{t(batch.trigger === 'MANUAL' ? 'imports.page.manual' : 'imports.page.auto')}</Badge>
        {batch.fullScan && <Badge>{t('imports.page.fullScan')}</Badge>}
        {batch.status === 'UNDONE' && <Badge tone="warning">{t('imports.page.undone')}</Badge>}
        {batch.cutoffChange && <Badge tone="info">{t('imports.cutoffChange.badge')}</Badge>}
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
      {batch.cutoffChange && (
        <p className={styles.muted}>
          {t('imports.cutoffChange.history', {
            from: formatDateTime(batch.cutoffChange.from, locale),
            to: batch.cutoffChange.to ? formatDateTime(batch.cutoffChange.to, locale) : '',
          })}
        </p>
      )}
      {open && <BatchDetails batchId={batch.id} />}
    </li>
  );
}

// Página "Importações" (9.2, D300): pendências abertas de todos os lotes e o histórico, com "Carregar mais".
export default function ImportsPage() {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const [undoId, setUndoId] = useState<number | null>(null);
  // Data de corte e varredura completa (9.5.1c): o mesmo fluxo do card (trava "importando…", resumo e erro).
  const importer = useCsfloatImport();
  const cutoffAt = importer.integration?.tradesCutoffAt ?? null;

  const entriesQuery = useQuery({ queryKey: queryKeys.imports.entries, queryFn: ({ signal }) => listOpenImportEntries(signal) });
  // Ignoradas (9.5.1b, D329): a contagem aparece sempre; a lista, ao abrir a seção.
  const ignoredQuery = useQuery({ queryKey: queryKeys.imports.ignored, queryFn: ({ signal }) => listIgnoredImportEntries(signal) });
  const [showIgnored, setShowIgnored] = useState(false);
  const ignored = ignoredQuery.data?.entries ?? [];
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

      {(importer.disabledReason === 'NO_KEY' || importer.disabledReason === 'NO_STORE') && (
        <section className={styles.section} data-testid="imports-setup">
          <p>{t('csfloatSetup.modalBody')}</p>
          <p><Link href="/settings/#csfloat">{t('csfloatSetup.configure')}</Link></p>
        </section>
      )}

      {cutoffAt && (
        <section className={styles.section} aria-labelledby="imports-cutoff-title" id="cutoff">
          <h2 id="imports-cutoff-title" className={styles.sectionTitle}>
            {t('imports.cutoffChange.blockTitle', { date: formatDateTime(cutoffAt, locale) })}
          </h2>
          <p className={styles.muted}>{t('imports.cutoffChange.blockBody')}</p>
          <p className={styles.muted}>{t('imports.cutoffChange.singleHint')}</p>
          <ul className={styles.muted}>
            <li>{t('imports.cutoffChange.backwardHelp')}</li>
            <li>{t('imports.cutoffChange.forwardHelp')}</li>
            <li>{t('imports.cutoffChange.undoHelp')}</li>
          </ul>
          <div className={styles.batchActions}>
            <button type="button" className={styles.button} onClick={() => importer.openCutoffChange()} disabled={importer.disabledReason !== null}>
              {importer.disabledReason === 'RUNNING' ? t('imports.running') : t('imports.cutoffChange.open')}
            </button>
            <button type="button" className={styles.button} onClick={() => importer.start({ fullScan: true })} disabled={importer.disabledReason !== null}>
              {t('settings.integrations.csfloat.fullScan')}
            </button>
          </div>
        </section>
      )}

      <section className={styles.section} aria-labelledby="imports-open-title">
        <h2 id="imports-open-title" className={styles.sectionTitle}>{t('imports.page.open')}</h2>
        {entriesQuery.error !== null && <p className={styles.error} role="alert">{errorMessageFor(entriesQuery.error, tLoose, locale)}</p>}
        {entriesQuery.isPending && <p className={styles.muted}>{t('common.loading')}</p>}
        {entriesQuery.data && entries.length === 0 && <div className={styles.empty}>{t('imports.page.noOpen')}</div>}
        {entries.length > 0 && <ImportEntriesList entries={entries} />}
      </section>

      {ignored.length > 0 && (
        <section className={styles.section} aria-labelledby="imports-ignored-title">
          <h2 id="imports-ignored-title" className={styles.sectionTitle}>
            <button type="button" className={styles.button} onClick={() => setShowIgnored((v) => !v)} aria-expanded={showIgnored}>
              {showIgnored ? '▾' : '▸'} {tPlural('imports.page.ignored', ignored.length)}
            </button>
          </h2>
          {showIgnored && (
            <>
              <p className={styles.muted}>{t('imports.page.ignoredHint')}</p>
              <ImportEntriesList entries={ignored} ignoredList />
            </>
          )}
        </section>
      )}

      <section className={styles.section} aria-labelledby="imports-history-title">
        <h2 id="imports-history-title" className={styles.sectionTitle}>{t('imports.page.batches')}</h2>
        {batchesQuery.error !== null && <p className={styles.error} role="alert">{errorMessageFor(batchesQuery.error, tLoose, locale)}</p>}
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

      {importer.dialogs}
      {undoId !== null && <UndoImportDialog batchId={undoId} onClose={() => setUndoId(null)} onFinished={() => setUndoId(null)} />}
    </>
  );
}
