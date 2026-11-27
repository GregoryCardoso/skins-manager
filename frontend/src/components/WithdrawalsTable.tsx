'use client';

import { useMemo } from 'react';
import { useLocale, useT } from '@/i18n/I18nProvider';
import { formatDate, formatMoney } from '@/lib/format';
import type { Withdrawal } from '@/types/api';
import styles from './moneyTables.module.css';
import DataTable, { type Column } from './ui/DataTable';
import Menu from './ui/Menu';
import Money from './ui/Money';

interface Props {
  withdrawals: Withdrawal[];
  onEdit: (withdrawal: Withdrawal) => void;
  onDelete: (withdrawal: Withdrawal) => void;
}

// Saques em DataTable (12.7b). Sempre à vista: data, valor sacado, líquido e ações; loja e taxa saem em janela estreita; o valor recebido
// (informativo) e a observação passam para a linha expandida. Sacado e taxa na moeda da loja; o líquido em US$ com "≈" (ou "≈ US$" em
// loja fora do dólar), tudo calculado no backend.
export default function WithdrawalsTable({ withdrawals, onEdit, onDelete }: Props) {
  const t = useT();
  const locale = useLocale();

  const columns = useMemo<Column<Withdrawal>[]>(() => {
    const none = <span className={styles.muted}>{t('common.none')}</span>;
    return [
      { id: 'date', header: t('withdrawals.columns.date'), priority: 1, cell: (w) => formatDate(w.withdrawnAt, locale) },
      {
        id: 'amount', header: t('withdrawals.columns.amount'), priority: 1, align: 'end',
        cell: (w) => (w.amountStoreCents !== null && w.currency !== null ? formatMoney(w.amountStoreCents, w.currency, locale) : none),
      },
      {
        id: 'net', header: t('withdrawals.net'), priority: 1, align: 'end',
        cell: (w) => (
          <Money size="md" align="end" cents={w.amountUsdCents} estimated={w.estimated} approxCents={w.legacyWithoutStore ? null : w.approxCents} approxCurrency={w.approxCurrency} />
        ),
      },
      { id: 'store', header: t('withdrawals.columns.store'), priority: 2, cell: (w) => (w.legacyWithoutStore ? <span className={styles.muted}>{t('withdrawals.legacyNoStore')}</span> : w.storeName) },
      {
        id: 'fee', header: t('withdrawals.columns.fee'), priority: 2, align: 'end',
        cell: (w) => (w.feeCents !== null && w.currency !== null ? formatMoney(w.feeCents, w.currency, locale) : none),
      },
      {
        id: 'received', header: t('withdrawals.columns.received'), priority: 3, align: 'end',
        cell: (w) => (w.amountBrlCents === null
          ? none
          : (
            <>
              {formatMoney(w.amountBrlCents, w.amountBrlCurrency ?? 'BRL', locale)}
              {w.legacyWithoutStore && <small className={styles.muted}> {t('withdrawals.legacyRecordedBrl')}</small>}
            </>
          )),
      },
      { id: 'note', header: t('withdrawals.columns.note'), priority: 3, cell: (w) => w.note ?? none },
      {
        id: 'actions', header: t('withdrawals.columns.actions'), hideHeader: true, align: 'end', priority: 1,
        cell: (w) => (
          <Menu
            label={t('profit.rowActions', { date: formatDate(w.withdrawnAt, locale) })}
            items={[
              { id: 'edit', label: t('withdrawals.actions.edit'), onSelect: () => onEdit(w) },
              { id: 'delete', label: t('withdrawals.actions.delete'), tone: 'danger', onSelect: () => onDelete(w) },
            ]}
          />
        ),
      },
    ];
  }, [t, locale, onEdit, onDelete]);

  return (
    <DataTable
      caption={t('withdrawals.title')}
      columns={columns}
      rows={withdrawals}
      getRowId={(w) => String(w.id)}
      rowLabel={(w) => formatDate(w.withdrawnAt, locale)}
    />
  );
}
