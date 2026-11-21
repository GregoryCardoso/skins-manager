'use client';

import { useLanguage, useT } from '@/i18n/I18nProvider';
import { formatDate, formatMoney } from '@/lib/format';
import type { Deposit } from '@/types/api';
import styles from './DepositsTable.module.css';

interface Props {
  deposits: Deposit[];
  onEdit: (deposit: Deposit) => void;
  onDelete: (deposit: Deposit) => void;
}

export default function DepositsTable({ deposits, onEdit, onDelete }: Props) {
  const t = useT();
  const language = useLanguage();

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t('deposits.columns.date')}</th>
            <th scope="col">{t('deposits.columns.amount')}</th>
            <th scope="col">{t('deposits.columns.store')}</th>
            <th scope="col">{t('deposits.columns.note')}</th>
            <th scope="col">{t('deposits.columns.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {deposits.map((deposit) => (
            <tr key={deposit.id} className={styles.row}>
              <td className={styles.date}>{formatDate(deposit.depositedAt, language)}</td>
              <td className={styles.amount}>{formatMoney(deposit.amountBrlCents, 'BRL', language)}</td>
              <td>{deposit.storeName ?? <span className={styles.muted}>{t('deposits.noStore')}</span>}</td>
              <td className={styles.note}>{deposit.note ?? <span className={styles.muted}>{t('common.none')}</span>}</td>
              <td>
                <div className={styles.actions}>
                  <button type="button" className={styles.button} onClick={() => onEdit(deposit)}>
                    {t('deposits.actions.edit')}
                  </button>
                  <button type="button" className={`${styles.button} ${styles.danger}`} onClick={() => onDelete(deposit)}>
                    {t('deposits.actions.delete')}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
