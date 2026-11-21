'use client';

import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDate, formatFloat, formatMoney, formatRemaining, remainingToText } from '@/lib/format';
import { isHttpsLink, isSafeInspectLink } from '@/lib/safeUrl';
import type { ItemView, Store } from '@/types/api';
import { Badge, type BadgeTone } from './badges';
import ItemActions from './ItemActions';
import ItemImage from './ItemImage';
import styles from './InventoryTable.module.css';
import MinPriceCell from './MinPriceCell';

interface Props {
  items: ItemView[];
  stores: Store[];
  onEdit: (item: ItemView) => void;
  onSell: (item: ItemView) => void;
  onUnsell: (item: ItemView) => void;
  onDelete: (item: ItemView) => void;
  onHistory: (item: ItemView) => void;
}

const BUCKET_TONES: Record<string, BadgeTone> = {
  RECENTE: 'success',
  EM_GIRO: 'neutral',
  AGARRADO: 'danger',
  EM_TRADE_LOCK: 'info',
  GIRO_RAPIDO: 'success',
  GIRO_NORMAL: 'neutral',
  DEMOROU_VENDER: 'warning',
};

function isStagnant(item: ItemView): boolean {
  return 'agingBucket' in item.aging && item.aging.agingBucket === 'AGARRADO';
}

function isLockedStock(item: ItemView): boolean {
  return item.status === 'EM_ESTOQUE' && item.tradeLock.isLocked;
}

function ItemCell({ item }: { item: ItemView }) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLanguage();

  const details: string[] = [];
  if (item.variant && item.variant !== 'NORMAL') details.push(tLoose(`enums.variant.${item.variant}`));
  const exteriorLabel = item.exterior ? tLoose(`enums.exterior.${item.exterior}`) : null;
  if (item.exterior) details.push(tLoose(`enums.exteriorShort.${item.exterior}`));
  if (item.floatValue !== null) details.push(`float ${formatFloat(item.floatValue, locale)}`);
  if (item.phase) details.push(item.phase);
  if (item.paintSeed !== null) details.push(`seed ${item.paintSeed}`);

  return (
    <div className={styles.itemCell}>
      <strong className={styles.name}>{item.name}</strong>
      {details.length > 0 && (
        <span className={styles.details} title={exteriorLabel ?? undefined}>
          {details.join(' · ')}
        </span>
      )}
      <span className={styles.badges}>
        <Badge>{tLoose(`enums.category.${item.category}`)}</Badge>
        {item.isLegacy && <Badge tone="warning">{t('inventory.legacy')}</Badge>}
        {item.status === 'VENDIDO' && <Badge tone="info">{t('inventory.sold')}</Badge>}
      </span>
    </div>
  );
}

function StoreCell({ item, stores }: { item: ItemView; stores: Store[] }) {
  const t = useT();
  const storeName = item.purchaseStoreId !== null ? stores.find((s) => s.id === item.purchaseStoreId)?.name : undefined;
  if (item.acquisitionType === 'GANHEI') {
    return (
      <div className={styles.stack}>
        <Badge tone="success" title={item.originDetail ?? undefined}>{t('inventory.ganhei')}</Badge>
        {storeName && <span className={styles.muted}>{t('inventory.informativeStore', { store: storeName })}</span>}
        {item.originDetail && <span className={styles.muted}>{item.originDetail}</span>}
      </div>
    );
  }
  return <span>{storeName ?? t('common.none')}</span>;
}

function DaysCell({ item }: { item: ItemView }) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const aging = item.aging;
  if ('daysInInventory' in aging) {
    const inInventory = (
      <span className={styles.muted}>{t('inventory.daysInInventory', { days: tPlural('common.dayCount', aging.daysInInventory) })}</span>
    );
    // Em trade lock não há dias à venda nem faixa (D160): selo com o tempo restante.
    if (aging.daysForSale === null) {
      const time = remainingToText(formatRemaining(item.tradeLock.remainingMs), {
        d: t('tradeLock.units.d'), h: t('tradeLock.units.h'), min: t('tradeLock.units.min'),
      });
      return (
        <div className={styles.stack}>
          <Badge tone={BUCKET_TONES[aging.agingBucket]} icon="🔒">{t('inventory.inTradeLock', { time })}</Badge>
          {inInventory}
        </div>
      );
    }
    return (
      <div className={styles.stack}>
        <span>{t('inventory.daysForSale', { days: tPlural('common.dayCount', aging.daysForSale) })}</span>
        <Badge tone={BUCKET_TONES[aging.agingBucket]}>{tLoose(`enums.agingBucket.${aging.agingBucket}`)}</Badge>
        {inInventory}
      </div>
    );
  }
  return (
    <div className={styles.stack}>
      <span>{t('inventory.turnaround', { days: tPlural('common.dayCount', aging.turnaroundDays) })}</span>
      <Badge tone={BUCKET_TONES[aging.turnaroundBucket]}>{tLoose(`enums.turnaroundBucket.${aging.turnaroundBucket}`)}</Badge>
      <span className={styles.muted}>{t('inventory.daysHeld', { days: tPlural('common.dayCount', aging.daysHeld) })}</span>
    </div>
  );
}

function TradeLockCell({ item }: { item: ItemView }) {
  const t = useT();
  const locale = useLanguage();
  if (item.status === 'VENDIDO') return <span className={styles.muted}>{t('common.none')}</span>;
  const lock = item.tradeLock;
  if (!lock.isLocked) return <span className={styles.muted}>{t('tradeLock.released')}</span>;
  const time = remainingToText(formatRemaining(lock.remainingMs), {
    d: t('tradeLock.units.d'), h: t('tradeLock.units.h'), min: t('tradeLock.units.min'),
  });
  const until = lock.tradeUnlockAt ? t('tradeLock.until', { date: formatDate(lock.tradeUnlockAt, locale) }) : undefined;
  return (
    <div className={styles.stack} title={until}>
      <Badge tone="info" icon="🔒">{t('tradeLock.locked')}</Badge>
      <span>{t('tradeLock.remaining', { time })}</span>
    </div>
  );
}

function InspectAction({ link }: { link: string | null }) {
  const t = useT();
  if (!link) return null;
  if (!isSafeInspectLink(link)) {
    return <span className={styles.muted} title={t('inventory.inspectInvalid')}>{t('inventory.inspectInvalid')}</span>;
  }
  const external = isHttpsLink(link);
  return (
    <a
      className={styles.inspect}
      href={link}
      rel="noopener noreferrer"
      {...(external ? { target: '_blank' } : {})}
    >
      {t('inventory.inspect')}
    </a>
  );
}

export default function InventoryTable({ items, stores, onEdit, onSell, onUnsell, onDelete, onHistory }: Props) {
  const t = useT();
  const locale = useLanguage();

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col"><span className={styles.srOnly}>{t('inventory.columns.image')}</span></th>
            <th scope="col">{t('inventory.columns.item')}</th>
            <th scope="col">{t('inventory.columns.store')}</th>
            <th scope="col">{t('inventory.columns.cost')}</th>
            <th scope="col">{t('inventory.columns.days')}</th>
            <th scope="col">{t('inventory.columns.tradeLock')}</th>
            <th scope="col">{t('inventory.columns.minPrice')}</th>
            <th scope="col">{t('inventory.columns.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const classes = [styles.row];
            if (isStagnant(item)) classes.push(styles.stagnant);
            if (isLockedStock(item)) classes.push(styles.locked);
            return (
              <tr key={item.id} className={classes.join(' ')}>
                <td><ItemImage category={item.category} url={item.catalog?.imageUrl} /></td>
                <td><ItemCell item={item} /></td>
                <td><StoreCell item={item} stores={stores} /></td>
                <td className={styles.nowrap}>{formatMoney(item.purchasePriceCents, item.purchaseCurrency, locale)}</td>
                <td><DaysCell item={item} /></td>
                <td><TradeLockCell item={item} /></td>
                <td>
                  {item.status === 'VENDIDO'
                    ? <span className={styles.muted}>{t('common.none')}</span>
                    : <MinPriceCell minPrices={item.minPrices} stores={stores} />}
                </td>
                <td>
                  <ItemActions item={item} onEdit={onEdit} onSell={onSell} onUnsell={onUnsell} onDelete={onDelete} onHistory={onHistory}>
                    <InspectAction link={item.inspectLink} />
                  </ItemActions>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
