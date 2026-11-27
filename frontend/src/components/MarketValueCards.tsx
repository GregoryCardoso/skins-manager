'use client';

import { useLocale, useT, useTPlural } from '@/i18n/I18nProvider';
import { formatMoney } from '@/lib/format';
import { profitUnrealizedCard, profitValueCard } from '@/lib/marketValueDisplay';
import PriceStatusIndicator from './PriceStatusIndicator';
import Money from './ui/Money';
import { StatCard } from './ui/StatCard';
import { useMarketSummary } from './useMarketSummary';

// Dois cards informativos da faixa "Mais números" (10.6, D365 item 7; StatCards na 12.7b): valor atual de mercado do estoque e PnL não
// realizado. Não leem o `profitSummary`, não entram no lucro real (lucro e prejuízo só se realizam na venda) e somem sem estoque.
// Devolve só os dois StatCards (a faixa que os envolve é do ProfitInfoStrip).
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
  const outside = t('profit.info.outsideFormula');

  return (
    <>
      <StatCard
        testId="market-value-card"
        label={t('profit.market.valueLabel')}
        help={`${valueHint} ${outside}`}
        value={
          value.kind === 'NO_PRICE'
            ? <span>{t('profit.market.noPrice')}</span>
            : <Money size="lg" estimated estimatedBadge={false} cents={value.usdCents} approxCents={value.approxCents} approxCurrency={value.approxCurrency} />
        }
        note={
          <>
            <span>{t('profit.market.badge')}</span>
            <br />
            <span>
              {t('profit.market.coverage', { priced: totals.pricedUnits, total: totals.unitCount })}
              {staleText ? ` · ${staleText}` : ''}
            </span>
            <PriceStatusIndicator />
          </>
        }
      />
      <StatCard
        testId="market-pnl-card"
        label={t('profit.market.pnlLabel')}
        help={`${pnlHint} ${outside}`}
        tone={pnl.kind === 'NET' ? (pnl.sign === 'POSITIVE' ? 'profit' : pnl.sign === 'NEGATIVE' ? 'loss' : 'neutral') : 'neutral'}
        value={
          pnl.kind === 'NO_PRICE'
            ? <span>{t('profit.market.noPrice')}</span>
            : pnl.kind === 'UNAVAILABLE'
              ? <span>{t('profit.market.unavailable')}</span>
              : <Money size="lg" signed estimated estimatedBadge={false} cents={pnl.cents} approxCents={pnl.approxCents} approxCurrency={pnl.approxCurrency} />
        }
        note={
          <>
            {pnl.kind === 'NET' && pnl.partial && <span>{t('profit.market.partial')}<br /></span>}
            <span>{t('profit.market.badge')}</span>
          </>
        }
      />
    </>
  );
}
