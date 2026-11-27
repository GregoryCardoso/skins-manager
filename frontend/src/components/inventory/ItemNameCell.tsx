'use client';

import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatFloat } from '@/lib/format';
import { itemDisplayName } from '@/lib/itemName';
import type { ItemGroup, ItemView } from '@/types/api';
import Badge from '../ui/Badge';
import ComponentThumbs from '../ComponentThumbs';
import GeneratedFromNote from '../GeneratedFromNote';
import styles from './inventory.module.css';

type Named = Pick<ItemView, 'name' | 'category' | 'variant' | 'exterior' | 'phase' | 'catalog'>;

// Nome em inglês (canônico) só quando o exibido é a tradução: sai o `title`, entra uma linha discreta que também chega ao teclado.
function EnglishName({ item }: { item: Named }) {
  const shown = itemDisplayName(item);
  return shown !== item.name ? <span className={styles.english}>{item.name}</span> : null;
}

function baseDetails(item: Named, tLoose: (key: string) => string): string[] {
  const details: string[] = [];
  if (item.variant && item.variant !== 'NORMAL') details.push(tLoose(`enums.variant.${item.variant}`));
  if (item.exterior) details.push(tLoose(`enums.exteriorShort.${item.exterior}`));
  return details;
}

// Imagem + nome da unidade (visão individual e unidades expandidas): detalhes (float, fase, seed), origem, componentes e selos.
// `hideSoldBadge`: na página Vendas todos os itens são vendidos, então o selo "Vendido" só repetiria o óbvio.
export function ItemNameCell({ item, hideSoldBadge = false }: { item: ItemView; hideSoldBadge?: boolean }) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const details = baseDetails(item, tLoose);
  if (item.floatValue !== null) details.push(`float ${formatFloat(item.floatValue, locale)}`);
  if (item.phase) details.push(item.phase);
  if (item.paintSeed !== null) details.push(`seed ${item.paintSeed}`);

  return (
    <div className={styles.itemCell}>
      <strong className={styles.name}>{itemDisplayName(item)}</strong>
      <EnglishName item={item} />
      {details.length > 0 && <span className={styles.details}>{details.join(' · ')}</span>}
      <GeneratedFromNote item={item} />
      <ComponentThumbs components={item.components} />
      <span className={styles.badges}>
        <Badge tone="neutral">{tLoose(`enums.category.${item.category}`)}</Badge>
        {item.isLegacy && <Badge tone="pending">{t('inventory.legacy')}</Badge>}
        {item.status === 'VENDIDO' && !hideSoldBadge && <Badge tone="info">{t('inventory.sold')}</Badge>}
        {item.status === 'CONSUMIDO' && <Badge tone="neutral">{t('operations.consumedBadge')}</Badge>}
        {item.externalSource === 'CSFLOAT' && <Badge tone="info">{t('imports.badge')}</Badge>}
      </span>
    </div>
  );
}

// Nome da linha do grupo: nome, detalhes comuns e selos (categoria, encalhados, com componentes).
export function GroupNameCell({ group }: { group: ItemGroup }) {
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const details = baseDetails(group, tLoose);
  if (group.phase) details.push(group.phase);
  return (
    <div className={styles.itemCell}>
      <strong className={styles.name}>{itemDisplayName(group)}</strong>
      <EnglishName item={group} />
      {details.length > 0 && <span className={styles.details}>{details.join(' · ')}</span>}
      <span className={styles.badges}>
        <Badge tone="neutral">{tLoose(`enums.category.${group.category}`)}</Badge>
        {group.stagnantCount > 0 && <Badge tone="stuck" icon="alert">{tPlural('inventory.group.stagnant', group.stagnantCount)}</Badge>}
        {group.componentUnits > 0 && <Badge tone="info">{tPlural('inventory.group.withComponents', group.componentUnits)}</Badge>}
      </span>
    </div>
  );
}
