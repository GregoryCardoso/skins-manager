'use client';

import type { ReactNode } from 'react';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDate, formatMoney } from '@/lib/format';
import {
  groupMarketCell, groupUnrealizedCell, signOf, tabSummary, unitMarketCell, unitUnrealizedCell, type Sign,
} from '@/lib/marketValueDisplay';
import type { MarketValue, MarketValueTotals } from '@/types/api';
import HelpTip from './ui/HelpTip';
import styles from './MarketValueCell.module.css';
import { useMarketSummary } from './useMarketSummary';

// Células de valor de mercado e de PnL não realizado do inventário (10.6, D365 item 6). Só formatam o que o backend calculou.
// A dica (`title`) também vai num `srOnly`, porque o `title` não chega ao teclado nem ao leitor de tela.

function useSignedMoney() {
  const locale = useLocale();
  return (cents: number, sign: Sign = signOf(cents)) => {
    const abs = formatMoney(Math.abs(cents), 'USD', locale);
    return sign === 'POSITIVE' ? `+${abs}` : sign === 'NEGATIVE' ? `−${abs}` : abs;
  };
}

const signClass = (sign: Sign) => (sign === 'POSITIVE' ? styles.positive : sign === 'NEGATIVE' ? styles.negative : '');

// A explicação vai num HelpTip (abre com teclado e toque), no lugar do `title` (D370, 12.5a).
function Hinted({ title, topic = 'marketValue', children }: { title: string | null; topic?: 'marketValue' | 'unrealized'; children: ReactNode }) {
  const t = useT();
  return (
    <span className={styles.hinted}>
      <span className={styles.cell}>{children}</span>
      {title && <HelpTip topic={t(topic === 'unrealized' ? 'inventory.columns.unrealized' : 'inventory.columns.marketValue')}>{title}</HelpTip>}
    </span>
  );
}

// Linha discreta com o "≈" na moeda de conversão que veio na resposta; sem valor (sem cotação ou US$ como moeda de conversão), some.
function ApproxLine({ cents, currency }: { cents: number | null; currency: string }) {
  const t = useT();
  const locale = useLocale();
  if (cents === null || !currency) return null;
  return <small className={styles.side}>{t('common.approx', { value: formatMoney(cents, currency, locale) })}</small>;
}

export function UnitMarketCell({ marketValue }: { marketValue: MarketValue | null | undefined }) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const { summary } = useMarketSummary();
  const view = unitMarketCell(marketValue);
  const usd = (cents: number) => formatMoney(cents, 'USD', locale);

  if (view.kind === 'NONE') return <span className={styles.muted}>{t('common.none')}</span>;
  if (view.kind === 'NO_PRICE') {
    const noKey = view.reason === 'NOT_FETCHED' && summary !== null && !summary.configured;
    return (
      <Hinted title={tLoose(`inventory.marketValue.reason.${noKey ? 'NOT_FETCHED_NO_KEY' : view.reason}`)}>
        <span className={styles.muted}>{t('inventory.marketValue.noPrice')}</span>
      </Hinted>
    );
  }
  if (view.kind === 'NOT_PRICEABLE') {
    return (
      <Hinted title={tLoose(`inventory.marketValue.reason.${view.reason}`)}>
        <span className={styles.muted}>{t('inventory.marketValue.notPriceable')}</span>
      </Hinted>
    );
  }
  const date = view.pricedAt ? formatDate(view.pricedAt, locale) : null;
  const lines: string[] = [];
  if (view.parts.itemCents !== null) lines.push(t('inventory.marketValue.parts.item', { value: usd(view.parts.itemCents) }));
  if (view.parts.hangingCents !== null) lines.push(t('inventory.marketValue.parts.hanging', { value: usd(view.parts.hangingCents) }));
  if (view.parts.stickersInfoCents > 0) lines.push(t('inventory.marketValue.parts.stickers', { value: usd(view.parts.stickersInfoCents) }));
  if (view.parts.patchesInfoCents > 0) lines.push(t('inventory.marketValue.parts.patches', { value: usd(view.parts.patchesInfoCents) }));
  if (date) lines.push(t('inventory.marketValue.pricedAt', { date }));
  if (view.stale && date) lines.push(t('inventory.marketValue.staleHint', { date }));
  if (view.incomplete) lines.push(t('inventory.marketValue.incompleteHint'));
  return (
    <Hinted title={lines.join(' · ')}>
      <span className={styles.main}>{t('common.approx', { value: usd(view.usdCents) })}</span>
      <ApproxLine cents={view.approxCents} currency={view.approxCurrency} />
      {view.stale && <small className={styles.mark}>{t('inventory.marketValue.stale')}</small>}
      {view.incomplete && <small className={styles.mark}>{t('inventory.marketValue.incomplete')}</small>}
    </Hinted>
  );
}

export function UnitUnrealizedCell({ marketValue }: { marketValue: MarketValue | null | undefined }) {
  const t = useT();
  const tLoose = useTLoose();
  const signed = useSignedMoney();
  const view = unitUnrealizedCell(marketValue);
  if (view.kind === 'NONE') return <span className={styles.muted}>{t('common.none')}</span>;
  const gross = (cents: number | null) => (cents === null ? null : t('inventory.marketValue.gross', { value: signed(cents) }));
  if (view.kind === 'NET_UNAVAILABLE') {
    const reason = tLoose(`inventory.marketValue.netUnavailable.${view.reason ?? 'NET_NOT_COMPUTABLE'}`);
    return (
      <Hinted topic="unrealized" title={[reason, gross(view.grossCents)].filter(Boolean).join(' · ')}>
        <span className={styles.muted}>{t('common.none')}</span>
      </Hinted>
    );
  }
  return (
    <Hinted topic="unrealized" title={[t('inventory.marketValue.unrealizedHint'), gross(view.grossCents)].filter(Boolean).join(' · ')}>
      <span className={`${styles.main} ${signClass(view.sign)}`}>{t('common.approx', { value: signed(view.cents, view.sign) })}</span>
      <ApproxLine cents={view.approxCents} currency={view.approxCurrency} />
    </Hinted>
  );
}

export function GroupMarketCell({ totals }: { totals: MarketValueTotals | null | undefined }) {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const view = groupMarketCell(totals);
  if (view.kind === 'NONE') return <span className={styles.muted}>{t('common.none')}</span>;
  if (view.kind === 'NO_PRICE' || view.kind === 'NOT_PRICEABLE') {
    const title = t('inventory.marketValue.counts', { unpriced: view.unpricedUnits, notPriceable: view.notPriceableUnits });
    return (
      <Hinted title={title}>
        <span className={styles.muted}>{t(view.kind === 'NO_PRICE' ? 'inventory.marketValue.noPrice' : 'inventory.marketValue.notPriceable')}</span>
      </Hinted>
    );
  }
  return (
    <Hinted title={t('inventory.marketValue.groupOnlyPriced')}>
      <span className={styles.main}>{t('common.approx', { value: formatMoney(view.usdCents, 'USD', locale) })}</span>
      <ApproxLine cents={view.approxCents} currency={view.approxCurrency} />
      {view.partial && <small className={styles.side}>{t('inventory.marketValue.coverage', { priced: view.pricedUnits, total: view.unitCount })}</small>}
      {view.staleUnits > 0 && <small className={styles.mark}>{tPlural('inventory.marketValue.staleCount', view.staleUnits)}</small>}
    </Hinted>
  );
}

export function GroupUnrealizedCell({ totals }: { totals: MarketValueTotals | null | undefined }) {
  const t = useT();
  const signed = useSignedMoney();
  const view = groupUnrealizedCell(totals);
  if (view.kind === 'NONE') return <span className={styles.muted}>{t('common.none')}</span>;
  const gross = t('inventory.marketValue.gross', { value: signed(view.grossCents) });
  if (view.kind === 'NET_UNAVAILABLE') {
    return (
      <Hinted topic="unrealized" title={[t('inventory.marketValue.netUnavailable.GROUP'), gross, t('inventory.marketValue.groupOnlyPriced')].join(' · ')}>
        <span className={styles.muted}>{t('common.none')}</span>
      </Hinted>
    );
  }
  return (
    <Hinted topic="unrealized" title={[t('inventory.marketValue.unrealizedHint'), gross, t('inventory.marketValue.groupOnlyPriced')].join(' · ')}>
      <span className={`${styles.main} ${signClass(view.sign)}`}>{t('common.approx', { value: signed(view.cents, view.sign) })}</span>
      <ApproxLine cents={view.approxCents} currency={view.approxCurrency} />
      {view.partial && <small className={styles.side}>{t('inventory.marketValue.partial')}</small>}
    </Hinted>
  );
}

// Linha de resumo da aba (T102): valor de mercado e PnL não realizado de todo o estoque da aba (não segue os filtros).
export function MarketTabSummary({ totals, holding }: { totals: MarketValueTotals | null | undefined; holding: boolean }) {
  const t = useT();
  const locale = useLocale();
  const signed = useSignedMoney();
  const view = tabSummary(totals);
  if (!view) return null;
  const value = t('common.approx', { value: formatMoney(view.usdCents, 'USD', locale) });
  const parts = [t(holding ? 'inventory.marketValue.tabSummary.holding' : 'inventory.marketValue.tabSummary.forSale', { value })];
  if (view.netCents !== null && view.netSign !== null) {
    parts.push(t('inventory.marketValue.tabSummary.unrealized', { value: t('common.approx', { value: signed(view.netCents, view.netSign) }) }));
  }
  parts.push(t('inventory.marketValue.tabSummary.coverage', { priced: view.pricedUnits, total: view.unitCount }));
  return <p className={styles.summary}>{parts.join(' · ')}</p>;
}
