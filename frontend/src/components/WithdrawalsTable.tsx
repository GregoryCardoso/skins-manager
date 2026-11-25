'use client';

import { useLocale, useT } from '@/i18n/I18nProvider';
import { formatDate, formatMoney } from '@/lib/format';
import type { Withdrawal } from '@/types/api';
import styles from './DepositsTable.module.css';
import MoneyApprox from './MoneyApprox';

interface Props {
  withdrawals: Withdrawal[];
  onEdit: (withdrawal: Withdrawal) => void;
  onDelete: (withdrawal: Withdrawal) => void;
}

// Sacado e taxa na moeda da loja; "Líquido" em US$ com "≈ R$" (ou "≈ US$" em loja BRL); o "Recebido" em R$ é só informativo.
// Tudo o que é conversão vem do backend. Estilos compartilhados com a tabela de aportes.
export default function WithdrawalsTable({ withdrawals, onEdit, onDelete }: Props) {
  const t = useT();
  const locale = useLocale();

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t('withdrawals.columns.date')}</th>
            <th scope="col">{t('withdrawals.columns.store')}</th>
            <th scope="col">{t('withdrawals.columns.amount')}</th>
            <th scope="col">{t('withdrawals.columns.fee')}</th>
            <th scope="col">{t('withdrawals.net')}</th>
            <th scope="col">{t('withdrawals.columns.received')}</th>
            <th scope="col">{t('withdrawals.columns.note')}</th>
            <th scope="col">{t('withdrawals.columns.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {withdrawals.map((w) => {
            const currency = w.currency;
            return (
              <tr key={w.id} className={styles.row}>
                <td className={styles.date}>{formatDate(w.withdrawnAt, locale)}</td>
                <td>{w.legacyWithoutStore ? <span className={styles.muted}>{t('withdrawals.legacyNoStore')}</span> : w.storeName}</td>
                <td className={styles.amount}>
                  {w.amountStoreCents !== null && currency !== null
                    ? formatMoney(w.amountStoreCents, currency, locale)
                    : <span className={styles.muted}>{t('common.none')}</span>}
                </td>
                <td className={styles.numeric}>
                  {w.feeCents !== null && currency !== null
                    ? formatMoney(w.feeCents, currency, locale)
                    : <span className={styles.muted}>{t('common.none')}</span>}
                </td>
                <td className={styles.amount}>
                  <MoneyApprox cents={w.amountUsdCents} estimated={w.estimated} approxCents={w.legacyWithoutStore ? null : w.approxCents} />
                </td>
                <td className={styles.numeric}>
                  {w.amountBrlCents === null
                    ? <span className={styles.muted}>{t('common.none')}</span>
                    : (
                      <>
                        {formatMoney(w.amountBrlCents, 'BRL', locale)}
                        {w.legacyWithoutStore && <small className={styles.muted}> {t('withdrawals.legacyRecordedBrl')}</small>}
                      </>
                    )}
                </td>
                <td className={styles.note}>{w.note ?? <span className={styles.muted}>{t('common.none')}</span>}</td>
                <td>
                  <div className={styles.actions}>
                    <button type="button" className={styles.button} onClick={() => onEdit(w)}>
                      {t('withdrawals.actions.edit')}
                    </button>
                    <button type="button" className={`${styles.button} ${styles.danger}`} onClick={() => onDelete(w)}>
                      {t('withdrawals.actions.delete')}
                    </button>
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
