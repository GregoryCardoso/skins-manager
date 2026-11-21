'use client';

import { useLanguage, useT } from '@/i18n/I18nProvider';
import { formatDate } from '@/lib/format';
import type { ItemView } from '@/types/api';
import styles from './SaleReleaseNote.module.css';

// "Saldo liberado em <data>" (D214): só aparece enquanto o líquido da venda está retido; depois disso, nada.
export default function SaleReleaseNote({ item }: { item: ItemView }) {
  const t = useT();
  const locale = useLanguage();
  const release = item.saleRelease;
  if (!release || !release.isHeld || release.releasesAt === null) return null;
  return <span className={styles.note}>{t('sales.balanceReleasesAt', { date: formatDate(release.releasesAt, locale) })}</span>;
}
