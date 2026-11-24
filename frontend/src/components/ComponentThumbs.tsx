'use client';

import { useLanguage, useT } from '@/i18n/I18nProvider';
import { componentTooltip } from '@/lib/itemComponents';
import type { ItemComponent } from '@/types/api';
import styles from './ComponentThumbs.module.css';
import ItemImage from './ItemImage';

interface Props {
  components: ItemComponent[];
  size?: number;
}

// Miniaturas dos componentes aplicados (10.1): stickers colados e, à parte, o pendurado (chaveiro ou Sticker Slab).
// Só exibição; o `title` traz nome, slot, desgaste e pattern.
export default function ComponentThumbs({ components, size = 26 }: Props) {
  const t = useT();
  const language = useLanguage();
  if (components.length === 0) return null;
  const labels = { slot: t('itemForm.components.slotShort'), wear: t('itemForm.components.wearShort'), pattern: t('itemForm.components.patternShort') };
  const stickers = components.filter((c) => c.kind === 'STICKER' || c.kind === 'PATCH');
  const hanging = components.filter((c) => c.kind === 'CHARM' || c.kind === 'STICKER_SLAB');

  const thumb = (component: ItemComponent) => {
    const text = componentTooltip(component, language, labels);
    return (
      <li key={component.id} className={styles.thumb} title={text} aria-label={text}>
        <ItemImage category={component.kind === 'CHARM' ? 'PINGENTE' : 'STICKER'} url={component.imageUrl} size={size} />
      </li>
    );
  };

  return (
    <ul className={styles.list} aria-label={t('itemForm.components.thumbsLabel')}>
      {stickers.map(thumb)}
      {stickers.length > 0 && hanging.length > 0 && <li className={styles.separator} aria-hidden="true" />}
      {hanging.map(thumb)}
    </ul>
  );
}
