'use client';

import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDate, formatFloat, formatMoney, formatRate } from '@/lib/format';
import type { ItemView, Store } from '@/types/api';
import { Badge, type BadgeTone } from './badges';
import ItemActions from './ItemActions';
import ItemImage from './ItemImage';
import MoneyWithApprox from './MoneyWithApprox';
import styles from './SalesTable.module.css';

interface Props {
  items: ItemView[];
  stores: Store[];
  onEdit: (item: ItemView) => void;
  onUnsell: (item: ItemView) => void;
  onDelete: (item: ItemView) => void;
  onHistory: (item: ItemView) => void;
}

const BUCKET_TONES: Record<string, BadgeTone> = {
  GIRO_RAPIDO: 'success',
  GIRO_NORMAL: 'neutral',
  DEMOROU_VENDER: 'warning',
};

const noop = () => undefined;

function ItemCell({ item }: { item: ItemView }) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLanguage();
  const details: string[] = [];
  if (item.variant && item.variant !== 'NORMAL') details.push(tLoose(`enums.variant.${item.variant}`));
  if (item.exterior) details.push(tLoose(`enums.exteriorShort.${item.exterior}`));
  if (item.floatValue !== null) details.push(`float ${formatFloat(item.floatValue, locale)}`);
  if (item.phase) details.push(item.phase);
  return (
    <div className={styles.itemCell}>
      <strong className={styles.name}>{item.name}</strong>
      {details.length > 0 && <span className={styles.details}>{details.join(' · ')}</span>}
      <span className={styles.badges}>
        <Badge>{tLoose(`enums.category.${item.category}`)}</Badge>
        {item.isLegacy && <Badge tone="warning">{t('inventory.legacy')}</Badge>}
      </span>
    </div>
  );
}

function PurchaseStoreCell({ item, stores }: { item: ItemView; stores: Store[] }) {
  const t = useT();
  const name = item.purchaseStoreId !== null ? stores.find((s) => s.id === item.purchaseStoreId)?.name : undefined;
  if (item.acquisitionType === 'GANHEI') {
    return <Badge tone="success" title={item.originDetail ?? undefined}>{t('inventory.ganhei')}</Badge>;
  }
  return <span>{name ?? t('common.none')}</span>;
}

function DaysCell({ item }: { item: ItemView }) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const aging = item.aging;
  if (!('turnaroundDays' in aging)) return <span className={styles.muted}>{t('common.none')}</span>;
  return (
    <div className={styles.stack}>
      <span>{t('sales.daysAfterRelease', { days: tPlural('common.dayCount', aging.turnaroundDays) })}</span>
      <Badge tone={BUCKET_TONES[aging.turnaroundBucket]}>{tLoose(`enums.turnaroundBucket.${aging.turnaroundBucket}`)}</Badge>
      <span className={styles.muted}>{t('sales.daysHeld', { days: tPlural('common.dayCount', aging.daysHeld) })}</span>
    </div>
  );
}

function SaleRow({ item, stores, onEdit, onUnsell, onDelete, onHistory }: Props & { item: ItemView }) {
  const t = useT();
  const locale = useLanguage();
  const info = item.saleInfo;
  const saleStore = item.saleStoreId !== null ? stores.find((s) => s.id === item.saleStoreId)?.name : undefined;
  const saleCurrency = item.saleCurrency ?? 'USD';
  const rate = (value: number | null) => (value === null ? t('common.none') : formatRate(value, locale));

  const saleRateNote = info && info.fxUsed.sale !== null ? t('sales.saleRateNote', { rate: formatRate(info.fxUsed.sale, locale) }) : null;
  const profitUsd = info ? info.netReceivedUsdCents - info.purchaseCostUsdCents : item.saleProfitUsdCents;

  return (
    <tr className={styles.row}>
      <td><ItemImage category={item.category} url={item.catalog?.imageUrl} /></td>
      <td><ItemCell item={item} /></td>
      <td><PurchaseStoreCell item={item} stores={stores} /></td>
      <td>{saleStore ?? t('common.none')}</td>
      <td>
        {info ? (
          <MoneyWithApprox
            cents={item.purchasePriceCents}
            currency={item.purchaseCurrency}
            usdCents={info.purchaseCostUsdCents}
            approxBrlCents={info.approxBrl.purchaseCost}
            rateNote={info.fxUsed.purchase !== null ? formatRate(info.fxUsed.purchase, locale) : null}
          />
        ) : formatMoney(item.purchasePriceCents, item.purchaseCurrency, locale)}
      </td>
      <td>
        {info && item.salePriceCents !== null ? (
          <MoneyWithApprox
            cents={item.salePriceCents}
            currency={saleCurrency}
            usdCents={info.salePriceUsdCents}
            approxBrlCents={info.approxBrl.salePrice}
            rateNote={saleRateNote}
          />
        ) : t('common.none')}
      </td>
      <td>
        {info && item.netReceivedCents !== null ? (
          <div className={styles.stack}>
            <MoneyWithApprox
              cents={item.netReceivedCents}
              currency={saleCurrency}
              usdCents={info.netReceivedUsdCents}
              approxBrlCents={info.approxBrl.netReceived}
            />
            {item.netReceivedManual && <span className={styles.muted}>{t('sales.manualNet')}</span>}
          </div>
        ) : t('common.none')}
      </td>
      <td>
        {info && profitUsd !== null ? (
          <div className={styles.stack}>
            <MoneyWithApprox
              cents={profitUsd}
              currency="USD"
              usdCents={profitUsd}
              approxBrlCents={info.approxBrl.profit}
              signed
              highlightNegative
            />
            {info.usesRecordedFx && (
              <Badge
                tone="info"
                title={t('sales.fxTitle', { sale: rate(info.fxUsed.sale), purchase: rate(info.fxUsed.purchase) })}
              >
                {t('sales.fxBadge')}
              </Badge>
            )}
          </div>
        ) : t('common.none')}
      </td>
      <td className={styles.nowrap}>{item.soldAt ? formatDate(item.soldAt, locale) : t('common.none')}</td>
      <td><DaysCell item={item} /></td>
      <td>
        <ItemActions item={item} onEdit={onEdit} onSell={noop} onUnsell={onUnsell} onDelete={onDelete} onHistory={onHistory} />
      </td>
    </tr>
  );
}

export default function SalesTable(props: Props) {
  const t = useT();
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col"><span className={styles.srOnly}>{t('sales.columns.image')}</span></th>
            <th scope="col">{t('sales.columns.item')}</th>
            <th scope="col">{t('sales.columns.purchaseStore')}</th>
            <th scope="col">{t('sales.columns.saleStore')}</th>
            <th scope="col">{t('sales.columns.cost')}</th>
            <th scope="col">{t('sales.columns.salePrice')}</th>
            <th scope="col">{t('sales.columns.netReceived')}</th>
            <th scope="col">{t('sales.columns.profit')}</th>
            <th scope="col">{t('sales.columns.soldAt')}</th>
            <th scope="col">{t('sales.columns.days')}</th>
            <th scope="col">{t('sales.columns.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) => <SaleRow key={item.id} {...props} item={item} />)}
        </tbody>
      </table>
    </div>
  );
}
