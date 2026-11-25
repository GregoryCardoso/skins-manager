'use client';

import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDate, formatFloat, formatMoney, formatRate } from '@/lib/format';
import { itemDisplayName, itemEnglishTitle } from '@/lib/itemName';
import type { ItemView, Store } from '@/types/api';
import { Badge, type BadgeTone } from './badges';
import ComponentThumbs from './ComponentThumbs';
import GeneratedFromNote from './GeneratedFromNote';
import CostCell from './CostCell';
import ItemActions from './ItemActions';
import ItemImage from './ItemImage';
import MoneyWithApprox from './MoneyWithApprox';
import SaleReleaseNote from './SaleReleaseNote';
import styles from './SalesTable.module.css';

interface Props {
  items: ItemView[];
  stores: Store[];
  onEdit: (item: ItemView) => void;
  onUnsell: (item: ItemView) => void;
  onDelete: (item: ItemView) => void;
  onHistory: (item: ItemView) => void;
  // Linha apontada por `?item=<id>` (link do resumo da importação): destaque.
  highlightedItemId?: number | null;
}

const BUCKET_TONES: Record<string, BadgeTone> = {
  GIRO_RAPIDO: 'success',
  GIRO_NORMAL: 'neutral',
  DEMOROU_VENDER: 'warning',
  SEM_GIRO: 'neutral',
};

const noop = () => undefined;

function ItemCell({ item }: { item: ItemView }) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const details: string[] = [];
  if (item.variant && item.variant !== 'NORMAL') details.push(tLoose(`enums.variant.${item.variant}`));
  if (item.exterior) details.push(tLoose(`enums.exteriorShort.${item.exterior}`));
  if (item.floatValue !== null) details.push(`float ${formatFloat(item.floatValue, locale)}`);
  if (item.phase) details.push(item.phase);
  return (
    <div className={styles.itemCell}>
      <strong className={styles.name} title={itemEnglishTitle(item)}>{itemDisplayName(item)}</strong>
      {details.length > 0 && <span className={styles.details}>{details.join(' · ')}</span>}
      <GeneratedFromNote item={item} />
      <ComponentThumbs components={item.components} />
      <span className={styles.badges}>
        <Badge>{tLoose(`enums.category.${item.category}`)}</Badge>
        {item.isLegacy && <Badge tone="warning">{t('inventory.legacy')}</Badge>}
        {item.externalSource === 'CSFLOAT' && <Badge tone="info" title={t('imports.badgeHint')}>{t('imports.badge')}</Badge>}
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
  // Vendido fora de venda (D263): sem giro; só a faixa "sem giro" e o tempo desde a compra.
  if (aging.turnaroundDays === null) {
    return (
      <div className={styles.stack}>
        <Badge tone={BUCKET_TONES[aging.turnaroundBucket]}>{tLoose(`enums.turnaroundBucket.${aging.turnaroundBucket}`)}</Badge>
        <span className={styles.muted}>{t('sales.daysHeld', { days: tPlural('common.dayCount', aging.daysHeld) })}</span>
      </div>
    );
  }
  return (
    <div className={styles.stack}>
      <span>{t('sales.daysAfterRelease', { days: tPlural('common.dayCount', aging.turnaroundDays) })}</span>
      <Badge tone={BUCKET_TONES[aging.turnaroundBucket]}>{tLoose(`enums.turnaroundBucket.${aging.turnaroundBucket}`)}</Badge>
      <span className={styles.muted}>{t('sales.daysHeld', { days: tPlural('common.dayCount', aging.daysHeld) })}</span>
    </div>
  );
}

function SaleRow({ item, stores, onEdit, onUnsell, onDelete, onHistory, highlightedItemId = null }: Props & { item: ItemView }) {
  const t = useT();
  const locale = useLocale();
  const info = item.saleInfo;
  const saleStore = item.saleStoreId !== null ? stores.find((s) => s.id === item.saleStoreId)?.name : undefined;
  const saleCurrency = item.saleCurrency ?? 'USD';
  const rate = (value: number | null) => (value === null ? t('common.none') : formatRate(value, locale));

  const saleRateNote = info && info.fxUsed.sale !== null ? t('sales.saleRateNote', { rate: formatRate(info.fxUsed.sale, locale, saleCurrency ?? 'BRL') }) : null;
  const profitUsd = info ? info.netReceivedUsdCents - info.purchaseCostUsdCents : item.saleProfitUsdCents;

  return (
    <tr
      id={`item-row-${item.id}`}
      className={highlightedItemId === item.id ? `${styles.row} ${styles.highlighted}` : styles.row}
      aria-current={highlightedItemId === item.id ? 'true' : undefined}
    >
      <td><ItemImage category={item.category} url={item.catalog?.imageUrl} /></td>
      <td><ItemCell item={item} /></td>
      <td><PurchaseStoreCell item={item} stores={stores} /></td>
      <td>{saleStore ?? t('common.none')}</td>
      <td>
        {info && info.inheritedCostUsdCents !== 0 ? (
          <CostCell item={item} />
        ) : info ? (
          <MoneyWithApprox
            cents={item.purchasePriceCents}
            currency={item.purchaseCurrency}
            usdCents={info.purchaseCostUsdCents}
            approxCents={info.approx.purchaseCost}
            approxCurrency={info.approxCurrency}
            rateNote={info.fxUsed.purchase !== null ? formatRate(info.fxUsed.purchase, locale, item.purchaseCurrency) : null}
          />
        ) : formatMoney(item.purchasePriceCents, item.purchaseCurrency, locale)}
      </td>
      <td>
        {info && item.salePriceCents !== null ? (
          <MoneyWithApprox
            cents={item.salePriceCents}
            currency={saleCurrency}
            usdCents={info.salePriceUsdCents}
            approxCents={info.approx.salePrice}
            approxCurrency={info.approxCurrency}
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
              approxCents={info.approx.netReceived}
            approxCurrency={info.approxCurrency}
            />
            {item.netReceivedManual && <span className={styles.muted}>{t('sales.manualNet')}</span>}
            <SaleReleaseNote item={item} />
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
              approxCents={info.approx.profit}
            approxCurrency={info.approxCurrency}
              signed
              colorBySign
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
    <div className={styles.scroll} data-wide-table="">
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
