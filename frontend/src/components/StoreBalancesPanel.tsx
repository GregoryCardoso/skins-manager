'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { balanceBarScale } from '@/lib/balanceBarScale';
import { depositStoreOptions } from '@/lib/depositForm';
import { formatDate } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { withdrawalStoreOptions } from '@/lib/withdrawalForm';
import { getCsfloatIntegration, getCurrentStoreBalances } from '@/services/api';
import type { Store, StoreBalanceSummary } from '@/types/api';
import BalanceCheckDialog from './BalanceCheckDialog';
import { useMoneyLine } from './MoneyApprox';
import { usePreferences } from './PreferencesProvider';
import StoreBalanceHistory from './StoreBalanceHistory';
import StoreBalanceRow from './StoreBalanceRow';
import styles from './StoreBalancesPanel.module.css';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import Panel from './ui/Panel';
import Skeleton from './ui/Skeleton';
import { useToast } from './ui/Toast';
import { useStaleRateNote } from './useStaleRateNote';

type Dialog =
  | { kind: 'check'; store: StoreBalanceSummary; initialAmountCents?: number }
  | { kind: 'history'; store: StoreBalanceSummary };

interface Props {
  // As lojas completas: decidem em qual linha aparecem "Registrar aporte" e "Registrar saque" (as regras de sempre da loja).
  stores: Store[];
  onDeposit: (storeId: number) => void;
  onWithdraw: (storeId: number) => void;
}

// Painel "Saldo nas lojas" da página Lucro real (8.6, D246, D247; 12.7b): uma `StoreBalanceRow` por loja, com os totais embaixo.
// Saldo calculado (disponível + pendente) e "última conferência há X dias" vêm prontos do backend. Carrega os próprios dados; a consulta
// é invalidada por qualquer ação que mude aportes, saques, itens, lojas ou conferências (D259).
export default function StoreBalancesPanel({ stores, onDeposit, onWithdraw }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const moneyLine = useMoneyLine();
  const toast = useToast();
  const { fxRates, displayCurrency } = usePreferences();
  const staleRateNote = useStaleRateNote(fxRates.find((entry) => entry.currency === displayCurrency) ?? null);

  const query = useQuery({ queryKey: queryKeys.storeBalances.current, queryFn: ({ signal }) => getCurrentStoreBalances(signal) });
  const data = query.data ?? null;
  const error = query.error ?? null;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // A conferência com o CSFloat aparece só na loja da integração, com a chave salva (9.7).
  const integration = useQuery({ queryKey: queryKeys.integrations.csfloat, queryFn: ({ signal }) => getCsfloatIntegration(signal) }).data ?? null;

  const closeDialog = useCallback(() => setDialog(null), []);
  const saved = useCallback((message: string) => {
    setDialog(null);
    toast.show({ tone: 'success', message });
  }, [toast]);

  const scaleMax = useMemo(() => (data ? balanceBarScale(data.stores) : 0), [data]);
  const depositIds = useMemo(() => new Set(depositStoreOptions(stores, null).map((store) => store.id)), [stores]);
  const withdrawIds = useMemo(() => new Set(withdrawalStoreOptions(stores, null).map((store) => store.id)), [stores]);

  const nonWithdrawable = data ? data.totals.nonWithdrawableUsdCents : null;
  const hasNonWithdrawable = data !== null && data.stores.some((store) => !store.allowsWithdrawal);
  // A soma só aparece se for maior que 0 ou nula por falta de cotação (D212).
  const showNonWithdrawable = hasNonWithdrawable && (nonWithdrawable === null || nonWithdrawable > 0);

  const totalsLine = (cents: number | null, estimated: boolean, approx: number | null) =>
    moneyLine({ cents, estimated, approxCents: approx, approxCurrency: data?.totals.approxCurrency });

  return (
    <Panel
      title={t('storeBalances.title')}
      hint={
        <>
          {data && <span aria-live="polite">{tPlural('storeBalances.count', data.stores.length)}</span>}
          <span className={styles.intro}>{t('storeBalances.intro')}</span>
        </>
      }
    >
      {error !== null && (
        <ErrorState
          message={t('storeBalances.loadError', { reason: errorMessageFor(error, tLoose, locale) })}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      )}

      {data === null && error === null && <Skeleton lines={4} />}

      {data !== null && error === null && (
        <div aria-busy={query.isFetching}>
          {data.stores.length === 0 ? (
            <EmptyState title={t('storeBalances.empty')} />
          ) : (
            <>
              <ul className={styles.list}>
                {data.stores.map((store) => (
                  <StoreBalanceRow
                    key={store.storeId}
                    store={store}
                    scaleMaxCents={scaleMax}
                    canDeposit={depositIds.has(store.storeId)}
                    canWithdraw={withdrawIds.has(store.storeId)}
                    onDeposit={(target) => onDeposit(target.storeId)}
                    onWithdraw={(target) => onWithdraw(target.storeId)}
                    onCheck={(target) => setDialog({ kind: 'check', store: target })}
                    onHistory={(target) => setDialog({ kind: 'history', store: target })}
                    staleRateNote={staleRateNote}
                  />
                ))}
              </ul>

              <div className={styles.totals} role="group" aria-label={t('storeBalances.totalsTitle')}>
                <p className={styles.totalLine}>
                  {t('storeBalances.totalAvailable', { value: totalsLine(data.totals.availableUsdCents, data.totals.availableEstimated, data.totals.approx.available) })}
                </p>
                <p className={styles.totalLine}>
                  {data.totals.nextReleaseAt
                    ? t('storeBalances.totalPendingDate', {
                      value: totalsLine(data.totals.pendingUsdCents, data.totals.pendingEstimated, data.totals.approx.pending),
                      date: formatDate(data.totals.nextReleaseAt, locale),
                    })
                    : t('storeBalances.totalPending', { value: totalsLine(data.totals.pendingUsdCents, data.totals.pendingEstimated, data.totals.approx.pending) })}
                </p>
                {showNonWithdrawable && (
                  <p className={styles.totalLine}>
                    {nonWithdrawable === null
                      ? `${t('storeBalances.nonWithdrawableTotalLabel')} ${tLoose('warnings.FX_NOT_CONFIGURED')}`
                      : t('storeBalances.nonWithdrawableTotal', { value: totalsLine(nonWithdrawable, data.totals.nonWithdrawableEstimated, data.totals.approx.nonWithdrawable) })}
                  </p>
                )}
                <p className={styles.note}>{t('storeBalances.startHint')}</p>
              </div>
            </>
          )}
        </div>
      )}

      {dialog?.kind === 'check' && (
        <BalanceCheckDialog
          store={dialog.store}
          onClose={closeDialog}
          onSaved={saved}
          initialAmountCents={dialog.initialAmountCents ?? null}
          csfloat={Boolean(integration && integration.hasApiKey && integration.storeId === dialog.store.storeId)}
        />
      )}
      {dialog?.kind === 'history' && <StoreBalanceHistory store={dialog.store} onClose={closeDialog} />}
    </Panel>
  );
}
