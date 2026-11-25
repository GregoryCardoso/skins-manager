'use client';

import { useId } from 'react';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatMoney } from '@/lib/format';
import { rateToPercentText } from '@/lib/storeForm';
import type { Store } from '@/types/api';
import { Badge } from './badges';
import styles from './StoresTable.module.css';

interface Props {
  stores: Store[];
  // Loja com uma ação em andamento (desabilita os botões dela).
  busyId: number | null;
  onEdit: (store: Store) => void;
  onToggleActive: (store: Store) => void;
  onMakePrimary: (store: Store) => void;
  // Escolhe esta loja como a loja Steam do app, ou limpa a escolha se ela já é (10.4, D363).
  onToggleSteam?: (store: Store) => void;
  onDelete: (store: Store) => void;
}

interface ActionProps {
  label: string;
  // Motivo visível quando a ação está indisponível; sem motivo = ação disponível.
  disabledReason?: string | null;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}

// Ação indisponível fica desabilitada com o motivo visível, ligado ao botão por aria-describedby (T59).
function Action({ label, disabledReason = null, disabled = false, danger = false, onClick }: ActionProps) {
  const reasonId = useId();
  const unavailable = disabledReason !== null;
  return (
    <div className={styles.action}>
      <button
        type="button"
        className={`${styles.button} ${danger ? styles.danger : ''}`}
        onClick={onClick}
        disabled={unavailable || disabled}
        aria-describedby={unavailable ? reasonId : undefined}
      >
        {label}
      </button>
      {unavailable && <span id={reasonId} className={styles.reason}>{disabledReason}</span>}
    </div>
  );
}

function SaleFeeCell({ store }: { store: Store }) {
  const t = useT();
  const locale = useLocale();
  if (store.saleFeeType === null || store.saleFeeRate === null) {
    return <span className={styles.warn}>{t('storesTable.feesNotConfigured')}</span>;
  }
  const rate = rateToPercentText(store.saleFeeRate, locale);
  return <>{store.saleFeeType === 'DEDUCTED' ? t('storesTable.feeDeducted', { rate }) : t('storesTable.feeAdded', { rate })}</>;
}

function MinFixedCell({ store }: { store: Store }) {
  const t = useT();
  const locale = useLocale();
  const parts: string[] = [];
  if (store.saleMinFeeCents !== null) parts.push(t('storesTable.minFee', { value: formatMoney(store.saleMinFeeCents, store.currency, locale) }));
  if (store.saleFixedFeeCents > 0) parts.push(t('storesTable.fixedFee', { value: formatMoney(store.saleFixedFeeCents, store.currency, locale) }));
  return <>{parts.length > 0 ? parts.join(' · ') : t('common.none')}</>;
}

function WithdrawalCell({ store }: { store: Store }) {
  const t = useT();
  const locale = useLocale();
  if (!store.allowsWithdrawal) return <>{t('storesTable.withdrawalNo')}</>;
  const parts: string[] = [];
  parts.push(store.withdrawalFeeRate === null
    ? t('storesTable.withdrawalRateUnknown')
    : `${rateToPercentText(store.withdrawalFeeRate, locale)}%`);
  if (store.withdrawalFixedFeeCents > 0) {
    parts.push(t('storesTable.fixedFee', { value: formatMoney(store.withdrawalFixedFeeCents, store.currency, locale) }));
  }
  return <>{t('storesTable.withdrawalYes', { detail: parts.join(' · ') })}</>;
}

function SaleHoldCell({ store }: { store: Store }) {
  const t = useT();
  const tPlural = useTPlural();
  return <>{store.saleHoldDays > 0 ? tPlural('storesTable.saleHoldDays', store.saleHoldDays) : t('storesTable.saleHoldNone')}</>;
}

export default function StoresTable({ stores, busyId, onEdit, onToggleActive, onMakePrimary, onToggleSteam, onDelete }: Props) {
  const t = useT();
  const tLoose = useTLoose();

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t('storesTable.columns.name')}</th>
            <th scope="col">{t('storesTable.columns.currency')}</th>
            <th scope="col">{t('storesTable.columns.status')}</th>
            <th scope="col">{t('storesTable.columns.saleFee')}</th>
            <th scope="col">{t('storesTable.columns.rounding')}</th>
            <th scope="col">{t('storesTable.columns.minFixed')}</th>
            <th scope="col">{t('storesTable.columns.withdrawal')}</th>
            <th scope="col">{t('storesTable.columns.saleHold')}</th>
            <th scope="col">{t('storesTable.columns.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {stores.map((store) => {
            const busy = busyId === store.id;
            const toggleReason = store.isPrimary && store.isActive ? t('storesTable.reasons.primaryNeeded') : null;
            const primaryReason = store.isPrimary
              ? t('storesTable.reasons.alreadyPrimary')
              : !store.isActive ? t('storesTable.reasons.activateFirst') : null;
            const deleteReason = store.isPrimary
              ? t('storesTable.reasons.primaryNeeded')
              : store.inUse ? t('storesTable.reasons.inUse') : null;
            return (
              <tr key={store.id} className={`${styles.row} ${store.isActive ? '' : styles.inactive}`}>
                <th scope="row">
                  <span className={styles.nameCell}>
                    {store.name}
                    {store.isPrimary && <Badge tone="info">{t('storesTable.primary')}</Badge>}
                    {store.isSteamStore && <Badge tone="info" title={t('stores.steamHint')}>{t('stores.steamBadge')}</Badge>}
                  </span>
                </th>
                <td>{store.currency}</td>
                <td>
                  <Badge tone={store.isActive ? 'success' : 'neutral'}>
                    {store.isActive ? t('storesTable.active') : t('storesTable.inactive')}
                  </Badge>
                </td>
                <td><SaleFeeCell store={store} /></td>
                <td>{tLoose(`storeForm.rounding.${store.saleFeeRounding}`)}</td>
                <td><MinFixedCell store={store} /></td>
                <td><WithdrawalCell store={store} /></td>
                <td><SaleHoldCell store={store} /></td>
                <td>
                  <div className={styles.actions}>
                    <Action label={t('storesTable.actions.edit')} disabled={busy} onClick={() => onEdit(store)} />
                    <Action
                      label={store.isActive ? t('storesTable.actions.deactivate') : t('storesTable.actions.activate')}
                      disabledReason={toggleReason}
                      disabled={busy}
                      onClick={() => onToggleActive(store)}
                    />
                    <Action
                      label={t('storesTable.actions.makePrimary')}
                      disabledReason={primaryReason}
                      disabled={busy}
                      onClick={() => onMakePrimary(store)}
                    />
                    {onToggleSteam && (
                      <Action
                        label={store.isSteamStore ? t('stores.steamClear') : t('stores.steamSet')}
                        disabled={busy}
                        onClick={() => onToggleSteam(store)}
                      />
                    )}
                    <Action
                      label={t('storesTable.actions.delete')}
                      disabledReason={deleteReason}
                      disabled={busy}
                      danger
                      onClick={() => onDelete(store)}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
