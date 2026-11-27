'use client';

import { useMemo } from 'react';
import { useLocale, useT } from '@/i18n/I18nProvider';
import { formatDate, formatMoney } from '@/lib/format';
import type { Deposit } from '@/types/api';
import styles from './moneyTables.module.css';
import Badge from './ui/Badge';
import DataTable, { type Column } from './ui/DataTable';
import Menu from './ui/Menu';
import Money from './ui/Money';

interface Props {
  deposits: Deposit[];
  onEdit: (deposit: Deposit) => void;
  onDelete: (deposit: Deposit) => void;
}

// Aportes em DataTable (12.7b). Sempre à vista: data, valor creditado (com a taxa na nota) e ações; a loja sai em janela estreita e o
// valor pago (informativo) e a observação passam para a linha expandida. Valor em US$ com "≈" vindo do backend; nada é calculado aqui.
export default function DepositsTable({ deposits, onEdit, onDelete }: Props) {
  const t = useT();
  const locale = useLocale();

  const columns = useMemo<Column<Deposit>[]>(() => [
    { id: 'date', header: t('deposits.columns.date'), priority: 1, cell: (deposit) => formatDate(deposit.depositedAt, locale) },
    {
      id: 'amount', header: t('deposits.columns.amount'), priority: 1, align: 'end',
      cell: (deposit) => (
        <span className={styles.cell}>
          <Money
            size="md"
            align="end"
            cents={deposit.amountUsdCents}
            estimated={deposit.estimated}
            approxCents={deposit.legacy ? null : deposit.approxCents}
            approxCurrency={deposit.approxCurrency}
          />
          {!deposit.legacy && deposit.feeCents !== null && deposit.feeCents !== undefined && deposit.amountStoreCents !== null && (
            <small className={styles.muted}>
              {t('deposits.creditedAndFee', {
                credited: formatMoney(deposit.amountStoreCents, 'USD', locale),
                fee: formatMoney(deposit.feeCents, 'USD', locale),
              })}
            </small>
          )}
          {deposit.legacy && (
            <small className={styles.muted}>
              <Badge tone="neutral">{t('deposits.legacyBadge')}</Badge>
              {deposit.amountBrlCents !== null && ` ${formatMoney(deposit.amountBrlCents, deposit.amountBrlCurrency ?? 'BRL', locale)}`}
            </small>
          )}
        </span>
      ),
    },
    { id: 'store', header: t('deposits.columns.store'), priority: 2, cell: (deposit) => deposit.storeName ?? <span className={styles.muted}>{t('common.none')}</span> },
    {
      id: 'paid', header: t('deposits.columns.paid'), priority: 3, align: 'end',
      cell: (deposit) => (!deposit.legacy && deposit.amountBrlCents !== null
        ? formatMoney(deposit.amountBrlCents, deposit.amountBrlCurrency ?? 'BRL', locale)
        : <span className={styles.muted}>{t('common.none')}</span>),
    },
    { id: 'note', header: t('deposits.columns.note'), priority: 3, cell: (deposit) => deposit.note ?? <span className={styles.muted}>{t('common.none')}</span> },
    {
      id: 'actions', header: t('deposits.columns.actions'), hideHeader: true, align: 'end', priority: 1,
      cell: (deposit) => (
        <Menu
          label={t('profit.rowActions', { date: formatDate(deposit.depositedAt, locale) })}
          items={[
            { id: 'edit', label: t('deposits.actions.edit'), onSelect: () => onEdit(deposit) },
            { id: 'delete', label: t('deposits.actions.delete'), tone: 'danger', onSelect: () => onDelete(deposit) },
          ]}
        />
      ),
    },
  ], [t, locale, onEdit, onDelete]);

  return (
    <DataTable
      caption={t('deposits.title')}
      columns={columns}
      rows={deposits}
      getRowId={(deposit) => String(deposit.id)}
      rowLabel={(deposit) => formatDate(deposit.depositedAt, locale)}
    />
  );
}
