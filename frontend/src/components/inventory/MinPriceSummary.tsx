'use client';

import Link from 'next/link';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatMoney } from '@/lib/format';
import type { ItemView, MinPrice, Store, WarningCode } from '@/types/api';
import HelpTip from '../ui/HelpTip';
import Icon from '../ui/Icon';
import Money from '../ui/Money';
import styles from './inventory.module.css';

interface Props {
  minPrices: MinPrice[] | null;
  stores: Store[];
  // Mostra também as demais lojas ativas (linha expandida e unidades); na linha principal, só a loja principal.
  showOthers?: boolean;
}

// Para onde o aviso leva (D370, 12.5a). `PRICE_OVERFLOW` não tem para onde ir.
const WARNING_LINKS: Partial<Record<WarningCode, { href: string; labelKey: 'inventory.warnings.goToStores' | 'inventory.warnings.goToSettings' }>> = {
  FEES_NOT_CONFIGURED: { href: '/stores', labelKey: 'inventory.warnings.goToStores' },
  FX_NOT_CONFIGURED: { href: '/settings#fx', labelKey: 'inventory.warnings.goToSettings' },
};

function Warning({ entry }: { entry: MinPrice }) {
  const t = useT();
  const tLoose = useTLoose();
  const text = entry.warningCode ? tLoose(`warnings.${entry.warningCode}`) : entry.warning ?? t('common.none');
  const link = entry.warningCode ? WARNING_LINKS[entry.warningCode] : undefined;
  return (
    <span className={styles.warning}>
      <span className={styles.warningText}>
        <Icon name="alert" size={14} />
        <span>{text}</span>
      </span>
      {link && (
        <Link href={link.href} className={styles.warningLink}>
          {t(link.labelKey)}
        </Link>
      )}
    </span>
  );
}

function Entry({ entry, size }: { entry: MinPrice; size: 'sm' | 'md' }) {
  if (entry.minPriceCents === null) return <Warning entry={entry} />;
  return (
    <Money
      size={size}
      cents={entry.minPriceCents}
      currency={entry.currency}
      approxCents={entry.approx?.cents ?? null}
      approxCurrency={entry.approx?.currency ?? null}
    />
  );
}

// Preço mínimo "no saldo" (2.5): a loja principal em destaque; as demais lojas ativas, menores, abaixo (só quando `showOthers`).
// Nada é calculado aqui: os valores e os avisos vêm da API.
export default function MinPriceSummary({ minPrices, stores, showOthers = false }: Props) {
  const t = useT();
  if (minPrices === null) return <span className={styles.muted}>{t('common.none')}</span>;
  if (minPrices.length === 0) return <span className={styles.muted}>{t('inventory.noPrice')}</span>;

  const primaryId = stores.find((s) => s.isPrimary)?.id;
  const main = minPrices.find((m) => m.storeId === primaryId) ?? minPrices[0];
  const others = minPrices.filter((m) => m !== main);

  return (
    <div className={styles.minPrice}>
      <span className={styles.cellWithHelp}>
        <Entry entry={main} size="md" />
        <HelpTip topic={t('inventory.columns.minPrice')}>{t('inventory.help.minPrice')}</HelpTip>
      </span>
      <span className={styles.storeName}>{main.storeName}</span>
      {showOthers && others.length > 0 && (
        <ul className={styles.others} aria-label={t('inventory.otherStores')}>
          {others.map((entry) => (
            <li key={entry.storeId} className={styles.otherStore}>
              <span className={styles.storeName}>{entry.storeName}</span>
              <Entry entry={entry} size="sm" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Preço mínimo da linha do grupo (Q-12.5-3): com uma unidade na tela, o valor dela; com mais de uma, a faixa "US$ x – y" entre os valores que
// a API já devolveu para a loja principal (as unidades têm custos diferentes). Nada é recalculado; sem valor em nenhuma unidade, vale o
// da primeira (com o aviso da API).
export function GroupMinPrice({ units, stores }: { units: ItemView[]; stores: Store[] }) {
  const t = useT();
  const locale = useLocale();
  const primaryId = stores.find((s) => s.isPrimary)?.id;
  const entries = units.map((unit) => {
    const prices = unit.minPrices ?? [];
    return prices.find((m) => m.storeId === primaryId) ?? prices[0] ?? null;
  });
  const priced = entries.filter((entry): entry is MinPrice => entry !== null && entry.minPriceCents !== null);
  const first = units[0];
  if (priced.length < 2 || !first) return <MinPriceSummary minPrices={first?.minPrices ?? null} stores={stores} />;

  const currency = priced[0].currency;
  const sameStore = priced.every((entry) => entry.storeId === priced[0].storeId && entry.currency === currency);
  const cents = priced.map((entry) => entry.minPriceCents as number);
  const low = Math.min(...cents);
  const high = Math.max(...cents);
  if (!sameStore || low === high) return <MinPriceSummary minPrices={first.minPrices} stores={stores} />;

  const approxs = priced.map((entry) => entry.approx);
  const approxCurrency = approxs[0]?.currency;
  const approxOk = approxs.every((a) => a !== null && a.currency === approxCurrency);
  const approxCents = approxOk ? approxs.map((a) => (a as { cents: number }).cents) : [];
  return (
    <div className={styles.priceRange}>
      <span className={styles.cellWithHelp}>
        <span className={styles.rangeMain}>{`${formatMoney(low, currency, locale)} – ${formatMoney(high, currency, locale)}`}</span>
        <HelpTip topic={t('inventory.columns.minPrice')}>{t('inventory.help.priceRange')}</HelpTip>
      </span>
      {approxOk && approxCurrency && (
        <span className={styles.rangeApprox}>
          {t('common.approx', { value: `${formatMoney(Math.min(...approxCents), approxCurrency, locale)} – ${formatMoney(Math.max(...approxCents), approxCurrency, locale)}` })}
        </span>
      )}
      <span className={styles.storeName}>{priced[0].storeName}</span>
    </div>
  );
}
