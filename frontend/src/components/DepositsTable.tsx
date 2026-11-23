'use client';

import { useLanguage, useT } from '@/i18n/I18nProvider';
import { formatDate, formatMoney } from '@/lib/format';
import type { Deposit } from '@/types/api';
import styles from './DepositsTable.module.css';
import MoneyApprox from './MoneyApprox';

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
            <th scope="col">{t('deposits.columns.paid')}</th>
            <th scope="col">{t('deposits.columns.store')}</th>
            <th scope="col">{t('deposits.columns.note')}</th>
            <th scope="col">{t('deposits.columns.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {deposits.map((deposit) => (
            <tr key={deposit.id} className={styles.row}>
              <td className={styles.date}>{formatDate(deposit.depositedAt, language)}</td>
              <td className={styles.amount}>
                {/* Valor creditado em US$ com "≈ R$" (tudo calculado no backend). Legado: "≈ US$" + selo + R$ gravado. */}
                <MoneyApprox cents={deposit.amountUsdCents} estimated={deposit.estimated} approxCents={deposit.legacy ? null : deposit.approxBrlCents} />
                {!deposit.legacy && deposit.feeCents !== null && deposit.feeCents !== undefined && deposit.amountStoreCents !== null && (
                  <>
                    <br />
                    <small className={styles.muted}>
                      {t('deposits.creditedAndFee', {
                        credited: formatMoney(deposit.amountStoreCents, 'USD', language),
                        fee: formatMoney(deposit.feeCents, 'USD', language),
                      })}
                    </small>
                  </>
                )}
                {deposit.legacy && (
                  <>
                    <br />
                    <small className={styles.badge} title={t('deposits.legacyEditHint')}>{t('deposits.legacyBadge')}</small>
                    {deposit.amountBrlCents !== null && <small className={styles.muted}> {formatMoney(deposit.amountBrlCents, 'BRL', language)}</small>}
                  </>
                )}
              </td>
              <td className={styles.numeric}>
                {!deposit.legacy && deposit.amountBrlCents !== null
                  ? formatMoney(deposit.amountBrlCents, 'BRL', language)
                  : <span className={styles.muted}>{t('common.none')}</span>}
              </td>
              <td>{deposit.storeName ?? <span className={styles.muted}>{t('common.none')}</span>}</td>
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
