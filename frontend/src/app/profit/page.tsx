'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import DepositFormModal from '@/components/DepositFormModal';
import DepositsSection from '@/components/DepositsSection';
import ProfitEquation from '@/components/ProfitEquation';
import ProfitInfoStrip from '@/components/ProfitInfoStrip';
import StoreBalancesPanel from '@/components/StoreBalancesPanel';
import WithdrawalFormModal from '@/components/WithdrawalFormModal';
import WithdrawalsSection from '@/components/WithdrawalsSection';
import Button from '@/components/ui/Button';
import ErrorState from '@/components/ui/ErrorState';
import PageHeader from '@/components/ui/PageHeader';
import Skeleton from '@/components/ui/Skeleton';
import Tabs, { TabPanel } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { profitTabFromSearch, searchWithProfitTab, type ProfitTabId } from '@/lib/profitTabs';
import { queryKeys } from '@/lib/queryKeys';
import { getProfitSummary, listDeposits, listStores, listWithdrawals } from '@/services/api';
import styles from './page.module.css';

type Create = { kind: 'deposit' | 'withdrawal'; storeId: number | null };

// Lucro real (8.1 a 8.9; layout novo na 12.7b): a equação do lucro e o painel de saldos lado a lado, a faixa informativa e as abas
// Aportes e Saques. O formulário de novo aporte/saque abre pelo cabeçalho ou pela linha da loja (com a loja já escolhida).
export default function ProfitPage() {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const toast = useToast();

  const summaryQuery = useQuery({ queryKey: queryKeys.profitSummary.all, queryFn: ({ signal }) => getProfitSummary(signal) });
  const storesQuery = useQuery({ queryKey: queryKeys.stores.all, queryFn: ({ signal }) => listStores(signal) });
  // As abas mostram a contagem: as mesmas consultas das seções (cache compartilhado).
  const depositsQuery = useQuery({ queryKey: queryKeys.deposits.all, queryFn: ({ signal }) => listDeposits(signal) });
  const withdrawalsQuery = useQuery({ queryKey: queryKeys.withdrawals.all, queryFn: ({ signal }) => listWithdrawals(signal) });
  const stores = storesQuery.data ?? [];
  const summary = summaryQuery.data ?? null;

  const [create, setCreate] = useState<Create | null>(null);
  const [tab, setTab] = useState<ProfitTabId>('deposits');
  // A aba vem da URL (`?tab=withdrawals`), lida no navegador (exportação estática, sem useSearchParams).
  useEffect(() => {
    setTab(profitTabFromSearch(window.location.search));
  }, []);
  const changeTab = (value: string) => {
    const next: ProfitTabId = value === 'withdrawals' ? 'withdrawals' : 'deposits';
    setTab(next);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${searchWithProfitTab(window.location.search, next)}${window.location.hash}`);
  };

  const closeCreate = useCallback(() => setCreate(null), []);
  const saved = useCallback((message: string) => {
    setCreate(null);
    toast.show({ tone: 'success', message });
  }, [toast]);
  const gone = useCallback(() => setCreate(null), []);

  const openDeposit = useCallback((storeId: number | null) => setCreate({ kind: 'deposit', storeId }), []);
  const openWithdrawal = useCallback((storeId: number | null) => setCreate({ kind: 'withdrawal', storeId }), []);

  return (
    <>
      <PageHeader
        title={t('profit.title')}
        subtitle={t('profit.subtitle')}
        actions={
          <>
            <Button icon="plus" onClick={() => openDeposit(null)}>{t('deposits.new')}</Button>
            <Button icon="wallet" onClick={() => openWithdrawal(null)}>{t('withdrawals.new')}</Button>
          </>
        }
      />

      <div className={styles.page}>
        <div className={styles.grid}>
          <div className={styles.cell}>
            {summaryQuery.error ? (
              <ErrorState
                message={t('profit.summary.loadError', { reason: errorMessageFor(summaryQuery.error, tLoose, locale) })}
                onRetry={() => summaryQuery.refetch()}
                retrying={summaryQuery.isFetching}
              />
            ) : summary === null ? (
              <Skeleton lines={6} />
            ) : (
              <ProfitEquation data={summary} depositFeeCents={depositsQuery.data?.totals.feeCents ?? 0} />
            )}
          </div>
          <div className={styles.cell}>
            <StoreBalancesPanel stores={stores} onDeposit={openDeposit} onWithdraw={openWithdrawal} />
          </div>
        </div>

        {summary !== null && <ProfitInfoStrip data={summary} />}

        <Tabs
          label={t('profit.tabs.label')}
          value={tab}
          onChange={changeTab}
          items={[
            { value: 'deposits', label: t('deposits.title'), count: depositsQuery.data?.totals.count },
            { value: 'withdrawals', label: t('withdrawals.title'), count: withdrawalsQuery.data?.totals.count },
          ]}
        >
          <TabPanel value="deposits"><DepositsSection onCreate={() => openDeposit(null)} /></TabPanel>
          <TabPanel value="withdrawals"><WithdrawalsSection onCreate={() => openWithdrawal(null)} /></TabPanel>
        </Tabs>
      </div>

      {create?.kind === 'deposit' && (
        <DepositFormModal stores={stores} initialStoreId={create.storeId} onClose={closeCreate} onSaved={saved} onGone={gone} />
      )}
      {create?.kind === 'withdrawal' && (
        <WithdrawalFormModal stores={stores} initialStoreId={create.storeId} onClose={closeCreate} onSaved={saved} onGone={gone} />
      )}
    </>
  );
}
