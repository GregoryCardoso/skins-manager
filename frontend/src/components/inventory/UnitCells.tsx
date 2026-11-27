'use client';

import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDate, formatMoney, formatRemaining, remainingToText } from '@/lib/format';
import type { TurnaroundBucket, ItemView, Store } from '@/types/api';
import Badge, { type BadgeTone } from '../ui/Badge';
import Money from '../ui/Money';
import TurnoverRule, { type TurnoverLimits } from '../ui/TurnoverRule';
import styles from './inventory.module.css';

const TURNAROUND_TONES: Record<TurnaroundBucket, BadgeTone> = {
  GIRO_RAPIDO: 'profit',
  GIRO_NORMAL: 'neutral',
  DEMOROU_VENDER: 'stuck',
  SEM_GIRO: 'neutral',
};

export function isStuck(item: ItemView): boolean {
  return 'agingBucket' in item.aging && item.aging.agingBucket === 'AGARRADO';
}

export function isLockedStock(item: ItemView): boolean {
  return item.status === 'EM_ESTOQUE' && item.tradeLock.isLocked;
}

// Giro da unidade: a régua (faixa e dias vêm da API; os limites, das configurações) ou, nas vendidas, o tempo até a venda.
export function TurnoverCell({ item, limits }: { item: ItemView; limits: TurnoverLimits }) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const aging = item.aging;

  if ('agingBucket' in aging) {
    const tradeLockText = remainingToText(formatRemaining(item.tradeLock.remainingMs), {
      d: t('tradeLock.units.d'), h: t('tradeLock.units.h'), min: t('tradeLock.units.min'),
    });
    return (
      <TurnoverRule
        kind="item"
        bucket={aging.agingBucket}
        daysForSale={aging.daysForSale}
        limits={limits}
        tradeLockText={tradeLockText}
        offSaleSinceText={item.offSaleAt ? formatDate(item.offSaleAt, locale) : undefined}
      />
    );
  }
  if (aging.turnaroundDays === null) {
    return (
      <div className={styles.stack}>
        <Badge tone={TURNAROUND_TONES[aging.turnaroundBucket]}>{tLoose(`enums.turnaroundBucket.${aging.turnaroundBucket}`)}</Badge>
        <span className={styles.muted}>{t('inventory.daysHeld', { days: tPlural('common.dayCount', aging.daysHeld) })}</span>
      </div>
    );
  }
  return (
    <div className={styles.stack}>
      <span>{t('inventory.turnaround', { days: tPlural('common.dayCount', aging.turnaroundDays) })}</span>
      <Badge tone={TURNAROUND_TONES[aging.turnaroundBucket]}>{tLoose(`enums.turnaroundBucket.${aging.turnaroundBucket}`)}</Badge>
    </div>
  );
}

// Dias no inventário (informativo; não é o giro).
export function DaysInInventoryCell({ item }: { item: ItemView }) {
  const t = useT();
  const tPlural = useTPlural();
  const aging = item.aging;
  const days = 'daysInInventory' in aging ? aging.daysInInventory : aging.daysHeld;
  return <span className={styles.muted}>{tPlural('common.dayCount', days)}</span>;
}

export function StoreCell({ item, stores }: { item: ItemView; stores: Store[] }) {
  const t = useT();
  const storeName = item.purchaseStoreId !== null ? stores.find((s) => s.id === item.purchaseStoreId)?.name : undefined;
  if (item.acquisitionType === 'GANHEI') {
    return (
      <div className={styles.stack}>
        <Badge tone="profit">{t('inventory.ganhei')}</Badge>
        {storeName && <span className={styles.muted}>{t('inventory.informativeStore', { store: storeName })}</span>}
        {item.originDetail && <span className={styles.muted}>{item.originDetail}</span>}
      </div>
    );
  }
  return <span>{storeName ?? t('common.none')}</span>;
}

// Custo da unidade (10.3, D362): sem custo de componentes é o preço de compra na moeda da compra; com ele, o custo efetivo em US$.
export function UnitCostCell({ item }: { item: ItemView }) {
  const t = useT();
  const locale = useLocale();
  const inherited = item.cost.inheritedUsdCents;
  const differs = item.cost.hasOperationCost ?? inherited !== 0;
  if (!differs) return <Money size="sm" cents={item.purchasePriceCents} currency={item.purchaseCurrency} />;
  const note = inherited >= 0
    ? t('operations.costIncludes', { value: formatMoney(inherited, 'USD', locale) })
    : t('operations.costSeparated', { value: formatMoney(Math.abs(inherited), 'USD', locale) });
  return (
    <span className={styles.stack}>
      <Money size="sm" cents={item.cost.effectiveUsdCents} currency="USD" estimated={item.cost.estimated} estimatedBadge={false} />
      <span className={styles.muted}>{note}</span>
    </span>
  );
}
