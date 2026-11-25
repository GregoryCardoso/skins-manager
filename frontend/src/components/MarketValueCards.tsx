'use client';

import { useLocale, useT, useTPlural } from '@/i18n/I18nProvider';
import { formatMoney } from '@/lib/format';
import { profitUnrealizedCard, profitValueCard, type Sign } from '@/lib/marketValueDisplay';
import MoneyApprox from './MoneyApprox';
import PriceStatusIndicator from './PriceStatusIndicator';
import { useMarketSummary } from './useMarketSummary';
import styles from './SummaryCards.module.css';

const signClass = (sign: Sign) => (sign === 'POSITIVE' ? styles.positive : sign === 'NEGATIVE' ? styles.negative : '');

// Dois cards informativos ao lado do "Estoque (pelo custo)" (10.6, D365 item 7, ajuste do usuário): valor atual de mercado do estoque e
// PnL não realizado. Não leem o `profitSummary`, não entram no lucro real (lucro e prejuízo só se realizam na venda) e somem sem estoque.
export default function MarketValueCards() {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const { summary } = useMarketSummary();
  if (!summary || summary.totals.unitCount === 0) return null;
  const { totals, byState } = summary;
  const value = profitValueCard(totals);
  const pnl = profitUnrealizedCard(totals);
  const signedUsd = (cents: number) => {
    const abs = formatMoney(Math.abs(cents), 'USD', locale);
    return cents > 0 ? `+${abs}` : cents < 0 ? `−${abs}` : abs;
  };
  const split = t('profit.market.split', {
    forSale: byState.forSale.pricedUnits > 0 ? t('common.approx', { value: formatMoney(byState.forSale.marketValueUsdCents, 'USD', locale) }) : t('profit.market.noPrice'),
    holding: byState.holding.pricedUnits > 0 ? t('common.approx', { value: formatMoney(byState.holding.marketValueUsdCents, 'USD', locale) }) : t('profit.market.noPrice'),
  });
  const valueHint = `${t('profit.market.valueHint')} ${split}`;
  const staleText = value.kind === 'OK' && value.staleUnits > 0 ? tPlural('profit.market.staleCount', value.staleUnits) : null;
  const pnlHint = pnl.kind === 'UNAVAILABLE'
    ? `${t('profit.market.pnlHint')} ${t('profit.market.unavailableHint', { value: signedUsd(pnl.grossCents) })}`
    : t('profit.market.pnlHint');

  return (
    <>
      <div className={styles.card} title={valueHint} data-testid="market-value-card">
        <span className={styles.label}>{t('profit.market.valueLabel')}</span>
        <span className={styles.value}>
          {value.kind === 'NO_PRICE'
            ? <span className={styles.unavailable}>{t('profit.market.noPrice')}</span>
            : <MoneyApprox cents={value.usdCents} estimated approxCents={value.approxCents} approxCurrency={value.approxCurrency} />}
        </span>
        <p className={styles.hint}>{t('profit.market.badge')}</p>
        <p className={styles.hint}>
          {t('profit.market.coverage', { priced: totals.pricedUnits, total: totals.unitCount })}
          {staleText ? ` · ${staleText}` : ''}
        </p>
        <span className={styles.srOnly}>{valueHint}</span>
        <PriceStatusIndicator />
      </div>
      <div className={styles.card} title={pnlHint} data-testid="market-pnl-card">
        <span className={styles.label}>{t('profit.market.pnlLabel')}</span>
        <span className={`${styles.value} ${pnl.kind === 'NET' ? signClass(pnl.sign) : ''}`}>
          {pnl.kind === 'NO_PRICE' && <span className={styles.unavailable}>{t('profit.market.noPrice')}</span>}
          {pnl.kind === 'UNAVAILABLE' && <span className={styles.unavailable}>{t('profit.market.unavailable')}</span>}
          {pnl.kind === 'NET' && (
            <>
              <span>{t('common.approx', { value: signedUsd(pnl.cents) })}</span>
              {pnl.approxCents !== null && <small className={styles.approx}>{t('common.approx', { value: formatMoney(pnl.approxCents, pnl.approxCurrency, locale) })}</small>}
            </>
          )}
        </span>
        {pnl.kind === 'NET' && pnl.partial && <p className={styles.hint}>{t('profit.market.partial')}</p>}
        <p className={styles.hint}>{t('profit.market.badge')}</p>
        <span className={styles.srOnly}>{pnlHint}</span>
      </div>
    </>
  );
}
