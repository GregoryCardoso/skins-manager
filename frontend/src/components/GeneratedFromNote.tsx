'use client';

import { useT, useTLoose } from '@/i18n/I18nProvider';
import type { ItemView } from '@/types/api';
import styles from './InventoryTable.module.css';

// "aberto de <caixa>" / "comprado no terminal <x>" sob o nome da unidade gerada por uma abertura (10.4, D363). O `originDetail` do
// usuário continua separado; este texto vem da operação e é traduzido aqui.
export default function GeneratedFromNote({ item }: { item: ItemView }) {
  const t = useT();
  const tLoose = useTLoose();
  const detached = item.detachedFrom;
  if (detached && detached.weaponName) {
    const text = tLoose(`operations.detachedFrom.${detached.mode ?? 'SPLIT'}`, { weapon: detached.weaponName, pattern: detached.pattern ?? '' });
    return <span className={styles.details} title={t('operations.title')}>{text}</span>;
  }
  const from = item.generatedFrom;
  if (!from || !from.containerName) return null;
  const variant = from.container === 'CASE' && from.keyName ? 'CASE_KEY' : from.container ?? 'CASE';
  const text = tLoose(`operations.generatedFrom.${variant}`, { container: from.containerName, key: from.keyName ?? '' });
  return <span className={styles.details} title={t('operations.title')}>{text}</span>;
}
