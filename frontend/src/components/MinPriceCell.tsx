'use client';

import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatApprox, formatMoney } from '@/lib/format';
import type { MinPrice, Store } from '@/types/api';
import styles from './MinPriceCell.module.css';

interface Props {
  minPrices: MinPrice[] | null;
  stores: Store[];
}

function Entry({ entry, primary }: { entry: MinPrice; primary: boolean }) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLanguage();

  let value;
  if (entry.minPriceCents === null) {
    const text = entry.warningCode ? tLoose(`warnings.${entry.warningCode}`) : entry.warning ?? t('common.none');
    value = <span className={styles.warning}>{text}</span>;
  } else {
    value = (
      <>
        <span className={primary ? styles.primaryValue : styles.value}>
          {formatMoney(entry.minPriceCents, entry.currency, locale)}
        </span>
        {entry.approx && (
          <span className={styles.approx}> {t('common.approx', { value: formatApprox(entry.approx, locale) })}</span>
        )}
      </>
    );
  }

  return (
    <div className={primary ? styles.primary : styles.other}>
      <span className={styles.store}>{entry.storeName}</span>
      <span>{value}</span>
    </div>
  );
}

// Preço mínimo "no saldo" (2.5): loja principal em destaque; demais lojas ativas menores, abaixo.
export default function MinPriceCell({ minPrices, stores }: Props) {
  const t = useT();
  if (minPrices === null) return <span className={styles.muted}>{t('common.none')}</span>;
  if (minPrices.length === 0) return <span className={styles.muted}>{t('inventory.noPrice')}</span>;

  const primaryId = stores.find((s) => s.isPrimary)?.id;
  const main = minPrices.find((m) => m.storeId === primaryId) ?? minPrices[0];
  const others = minPrices.filter((m) => m !== main);

  return (
    <div className={styles.cell}>
      <Entry entry={main} primary />
      {others.length > 0 && (
        <div className={styles.others} aria-label={t('inventory.otherStores')}>
          {others.map((entry) => (
            <Entry key={entry.storeId} entry={entry} primary={false} />
          ))}
        </div>
      )}
    </div>
  );
}
