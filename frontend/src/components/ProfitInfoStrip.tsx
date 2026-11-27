'use client';

import { useLocale, useT, useTPlural } from '@/i18n/I18nProvider';
import { formatPercent } from '@/lib/format';
import type { ProfitSummary } from '@/types/api';
import MarketValueCards from './MarketValueCards';
import { useMoneyLine } from './MoneyApprox';
import Money from './ui/Money';
import { PositionStrip, StatCard } from './ui/StatCard';

// Faixa informativa do Lucro real (8.9, D283; 12.7b): estoque à venda e em holding (a soma dos dois é o "Estoque pelo custo" da equação),
// "já sacado vs. colocado", valor de mercado e lucro não realizado (10.6) e perdas por consumo (10.4). Só exibe o que o backend calculou.
export default function ProfitInfoStrip({ data }: { data: ProfitSummary }) {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const moneyLine = useMoneyLine();
  const ratio = data.withdrawnVsDeposited;
  const losses = data.consumptionLosses;

  const money = (cents: number | null, approx: number | null, estimated: boolean) => (
    <Money size="lg" cents={cents} estimated={estimated} estimatedBadge={false} approxCents={approx} approxCurrency={data.approxCurrency} />
  );

  return (
    <PositionStrip label={t('profit.info.title')}>
      <StatCard
        label={t('profit.summary.stockForSale')}
        value={money(data.stockBreakdown.forSale.usdCents, data.stockBreakdown.forSale.approx, data.stockBreakdown.forSale.estimated)}
      />
      <StatCard
        label={t('profit.summary.stockOffSale')}
        value={money(data.stockBreakdown.offSale.usdCents, data.stockBreakdown.offSale.approx, data.stockBreakdown.offSale.estimated)}
      />
      <StatCard
        label={t('profit.summary.withdrawnVsDeposited')}
        value={ratio.ratio === null ? <span>{t('profit.summary.withdrawnVsDepositedNone')}</span> : formatPercent(ratio.ratio, locale)}
        note={
          ratio.ratio !== null && ratio.withdrawnUsdCents !== null && ratio.depositedUsdCents !== null
            ? t('profit.summary.withdrawnVsDepositedDetail', {
              withdrawn: moneyLine({ cents: ratio.withdrawnUsdCents, estimated: data.estimatedParts.withdrawals }),
              deposited: moneyLine({ cents: ratio.depositedUsdCents, estimated: data.estimatedParts.deposits }),
            })
            : undefined
        }
      />
      {/* Valor de mercado e PnL não realizado (10.6): informativos, lêem a própria consulta e não entram no lucro real. */}
      <MarketValueCards />
      {/* Perdas por consumo (10.4, D363): terminais não comprados. Só informativo, fora da fórmula do lucro real. */}
      {losses && losses.count > 0 && (
        <StatCard
          label={t('profit.summary.consumptionLosses')}
          help={`${t('profit.summary.consumptionLossesHint')} ${t('profit.info.outsideFormula')}`}
          value={money(losses.usdCents, losses.approx, losses.estimated)}
          note={tPlural('profit.summary.consumptionLossesCount', losses.count)}
        />
      )}
    </PositionStrip>
  );
}
