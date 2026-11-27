'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import CutoffTimeline from '@/components/imports/CutoffTimeline';
import ImportBatchList from '@/components/ImportBatchList';
import ImportEntriesList from '@/components/ImportEntriesList';
import Badge from '@/components/ui/Badge';
import Banner from '@/components/ui/Banner';
import Button from '@/components/ui/Button';
import Disclosure from '@/components/ui/Disclosure';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Menu from '@/components/ui/Menu';
import PageHeader from '@/components/ui/PageHeader';
import Panel from '@/components/ui/Panel';
import Skeleton from '@/components/ui/Skeleton';
import Tabs, { TabPanel } from '@/components/ui/Tabs';
import { useCsfloatImport } from '@/components/useCsfloatImport';
import UndoImportDialog from '@/components/UndoImportDialog';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { pausedReason } from '@/lib/autoImport';
import { formatDateTime } from '@/lib/format';
import { IMPORT_TABS, tabFromHash, type ImportTabId } from '@/lib/importsTabs';
import { queryKeys } from '@/lib/queryKeys';
import { listIgnoredImportEntries, listImportBatches, listOpenImportEntries } from '@/services/api';
import styles from './page.module.css';

const PAGE_SIZE = 20;

// Página "Importações" (9.2, D300; 12.9): faixa de estado, três abas ("Para conferir", "Ignoradas", "Histórico") com o hash na URL, o
// botão "Importar agora" e o menu "Mais opções" (varredura completa e alterar a data de corte).
export default function ImportsPage() {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const [undoId, setUndoId] = useState<number | null>(null);
  const [tab, setTab] = useState<ImportTabId>('review');
  const pendingScroll = useRef<string | null>(null);
  // Data de corte e varredura completa (9.5.1c): o mesmo fluxo do card (trava "importando…", resumo e erro).
  const importer = useCsfloatImport();
  const integration = importer.integration;
  const cutoffAt = integration?.tradesCutoffAt ?? null;
  const blocked = importer.disabledReason !== null;

  const entriesQuery = useQuery({ queryKey: queryKeys.imports.entries, queryFn: ({ signal }) => listOpenImportEntries(signal) });
  // Ignoradas (9.5.1b, D329): a contagem aparece sempre; a lista, na aba.
  const ignoredQuery = useQuery({ queryKey: queryKeys.imports.ignored, queryFn: ({ signal }) => listIgnoredImportEntries(signal) });
  const batchesQuery = useInfiniteQuery({
    queryKey: queryKeys.imports.batches,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) => listImportBatches({ limit: PAGE_SIZE, before: pageParam }, signal),
    getNextPageParam: (last) => last.nextBefore,
  });

  const entries = entriesQuery.data?.entries ?? [];
  const ignored = ignoredQuery.data?.entries ?? [];
  const batches = batchesQuery.data?.pages.flatMap((page) => page.batches) ?? [];

  const applyHash = useCallback(() => {
    const target = tabFromHash(window.location.hash);
    pendingScroll.current = target.scrollTo;
    setTab(target.tab);
  }, []);

  useEffect(() => {
    applyHash();
    window.addEventListener('hashchange', applyHash);
    window.addEventListener('popstate', applyHash);
    return () => {
      window.removeEventListener('hashchange', applyHash);
      window.removeEventListener('popstate', applyHash);
    };
  }, [applyHash]);

  // Depois de abrir o Histórico por `#cutoff`, o bloco da data de corte só existe quando a aba monta: rola então.
  useEffect(() => {
    if (pendingScroll.current === null || tab !== 'history') return;
    const id = pendingScroll.current;
    pendingScroll.current = null;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView?.({ block: 'start' }));
  }, [tab, cutoffAt]);

  const choose = (value: string) => {
    const next = IMPORT_TABS.find((id) => id === value) ?? 'review';
    pendingScroll.current = null;
    setTab(next);
    window.history.replaceState(window.history.state, '', `#${next}`);
  };

  const needsSetup = importer.disabledReason === 'NO_KEY' || importer.disabledReason === 'NO_STORE';
  const paused = integration ? pausedReason(integration) : null;

  const actions = (
    <>
      <Button variant="primary" icon="refresh" disabled={blocked} loading={importer.running || importer.disabledReason === 'RUNNING'} onClick={() => importer.start()}>
        {importer.running || importer.disabledReason === 'RUNNING' ? t('imports.running') : t('settings.integrations.csfloat.importNow')}
      </Button>
      <Menu
        label={t('imports.moreOptions')}
        trigger={<Button icon="more">{t('imports.moreOptions')}</Button>}
        items={[
          {
            id: 'full-scan',
            label: t('settings.integrations.csfloat.fullScan'),
            icon: 'refresh',
            disabled: blocked,
            onSelect: () => importer.start({ fullScan: true }),
          },
          {
            id: 'change-cutoff',
            label: t('imports.cutoffChange.open'),
            icon: 'clock',
            disabled: blocked || cutoffAt === null,
            onSelect: () => importer.openCutoffChange(),
          },
        ]}
      />
    </>
  );

  return (
    <>
      <PageHeader title={t('imports.page.title')} actions={actions} />

      <div className={styles.stack}>
        {needsSetup && (
          <Banner tone="info" action={{ label: t('csfloatSetup.configure'), href: '/settings/#csfloat' }}>
            <span data-testid="imports-setup">{t('csfloatSetup.modalBody')}</span>
          </Banner>
        )}

        {integration && (
          <ul className={styles.status} data-testid="imports-status">
            <li className={styles.statusItem}>
              <span>
                {integration.lastImportAt
                  ? t('imports.status.lastImport', { date: formatDateTime(integration.lastImportAt, locale) })
                  : t('settings.integrations.csfloat.neverImported')}
              </span>
            </li>
            <li className={styles.statusItem}>
              <span>{cutoffAt ? t('imports.status.cutoff', { date: formatDateTime(cutoffAt, locale) }) : t('imports.status.noCutoff')}</span>
            </li>
            <li className={styles.statusItem}>
              <span>
                <Badge tone={paused ? 'stuck' : integration.autoImportOnOpen ? 'profit' : 'neutral'}>
                  {paused ? t('imports.status.autoPaused') : integration.autoImportOnOpen ? t('imports.status.autoOn') : t('imports.status.autoOff')}
                </Badge>
              </span>
            </li>
          </ul>
        )}

        <Tabs
          label={t('imports.tabs.label')}
          value={tab}
          onChange={choose}
          items={[
            { value: 'review', label: t('imports.tabs.review'), count: entries.length },
            { value: 'ignored', label: t('imports.tabs.ignored'), count: ignored.length },
            { value: 'history', label: t('imports.tabs.history') },
          ]}
        >
          <TabPanel value="review">
            {entriesQuery.error !== null && (
              <ErrorState message={errorMessageFor(entriesQuery.error, tLoose, locale)} onRetry={() => void entriesQuery.refetch()} retrying={entriesQuery.isFetching} />
            )}
            {entriesQuery.isPending && <Skeleton height="8rem" radius="md" />}
            {entriesQuery.data && entries.length === 0 && <EmptyState icon="circleCheck" title={t('imports.page.noOpen')} />}
            {entries.length > 0 && <ImportEntriesList entries={entries} />}
          </TabPanel>

          <TabPanel value="ignored">
            {ignoredQuery.error !== null && (
              <ErrorState message={errorMessageFor(ignoredQuery.error, tLoose, locale)} onRetry={() => void ignoredQuery.refetch()} retrying={ignoredQuery.isFetching} />
            )}
            {ignoredQuery.isPending && <Skeleton height="6rem" radius="md" />}
            {ignoredQuery.data && ignored.length === 0 && <EmptyState icon="circleCheck" title={t('imports.page.ignoredHint')} />}
            {ignored.length > 0 && (
              <div className={styles.stack}>
                <p className={styles.muted}>{t('imports.page.ignoredHint')}</p>
                <ImportEntriesList entries={ignored} ignoredList />
              </div>
            )}
          </TabPanel>

          <TabPanel value="history">
            <div className={styles.stack}>
              {cutoffAt && (
                <Panel
                  title={t('imports.cutoffChange.blockTitle', { date: formatDateTime(cutoffAt, locale) })}
                  hint={t('imports.cutoffChange.blockBody')}
                  actions={(
                    <Button onClick={() => importer.openCutoffChange()} disabled={blocked}>
                      {importer.disabledReason === 'RUNNING' ? t('imports.running') : t('imports.cutoffChange.open')}
                    </Button>
                  )}
                  className={styles.cutoffPanel}
                >
                  <div id="cutoff" className={styles.cutoffBody}>
                    <CutoffTimeline current={cutoffAt} />
                    <Disclosure label={t('imports.cutoffChange.howItWorks')}>
                      <div className={styles.stack}>
                        <p className={styles.muted}>{t('imports.cutoffChange.singleHint')}</p>
                        <ul className={styles.list}>
                          <li>{t('imports.cutoffChange.backwardHelp')}</li>
                          <li>{t('imports.cutoffChange.forwardHelp')}</li>
                          <li>{t('imports.cutoffChange.undoHelp')}</li>
                        </ul>
                      </div>
                    </Disclosure>
                  </div>
                </Panel>
              )}

              <section className={styles.stack} aria-labelledby="imports-history-title">
                <h2 id="imports-history-title" className={styles.sectionTitle}>{t('imports.page.batches')}</h2>
                {batchesQuery.error !== null && (
                  <ErrorState message={errorMessageFor(batchesQuery.error, tLoose, locale)} onRetry={() => void batchesQuery.refetch()} retrying={batchesQuery.isFetching} />
                )}
                {batchesQuery.isPending && <Skeleton height="8rem" radius="md" />}
                {batchesQuery.data && batches.length === 0 && <EmptyState icon="imports" title={t('imports.page.noBatches')} />}
                {batches.length > 0 && <ImportBatchList batches={batches} onUndo={setUndoId} />}
                {batchesQuery.hasNextPage && (
                  <div>
                    <Button onClick={() => batchesQuery.fetchNextPage()} loading={batchesQuery.isFetchingNextPage}>{t('imports.page.loadMore')}</Button>
                  </div>
                )}
              </section>
            </div>
          </TabPanel>
        </Tabs>
      </div>

      {importer.dialogs}
      {undoId !== null && <UndoImportDialog batchId={undoId} onClose={() => setUndoId(null)} onFinished={() => setUndoId(null)} />}
    </>
  );
}
