'use client';

import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { describeFxRate } from '@/lib/fxDisplay';
import { formatDate } from '@/lib/format';
import type { ProfitSummary } from '@/types/api';
import { useMoneyLine } from './MoneyApprox';
import styles from './ProfitEquation.module.css';
import Badge from './ui/Badge';
import Banner from './ui/Banner';
import EmptyState from './ui/EmptyState';
import Equation, { type EquationRow } from './ui/Equation';
import Money from './ui/Money';
import Panel from './ui/Panel';
import { useStaleRateNote } from './useStaleRateNote';

interface Props {
  data: ProfitSummary;
  // Soma das taxas de aporte (US$), da lista de aportes: a nota do "Total colocado". Zero ou ausente = sem nota.
  depositFeeCents?: number;
}

// A equação do lucro real (8.5, D226; 12.7b): as seis linhas vêm direto do `GET /api/profit/summary`, sem recalcular nada no frontend.
// Saques recebidos + saldo disponível + pendente (linha própria, D370 P4) + estoque pelo custo − total colocado = lucro real. Abaixo ficam
// a nota da cotação (com o relógio da cotação velha), os avisos e, sem movimento nenhum, a dica de página vazia.
export default function ProfitEquation({ data, depositFeeCents = 0 }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const moneyLine = useMoneyLine();
  // A nota e o relógio de cotação velha seguem a MOEDA DE CONVERSÃO (antes usavam sempre o BRL). Em USD não há "≈" nem nota.
  const displayFx = data.fx.display ?? null;
  const isUsd = data.fx.displayCurrency === 'USD';
  const staleRateNote = useStaleRateNote(displayFx && !isUsd ? { source: displayFx.source, quotedAt: displayFx.quotedAt } : null);

  const money = (cents: number | null, approx: number | null, estimated: boolean) => (
    <Money size="md" align="end" cents={cents} estimated={estimated} estimatedBadge={false} approxCents={approx} approxCurrency={data.approxCurrency} />
  );

  const pending = data.pendingBalanceUsdCents;
  const pendingNotes: string[] = [];
  // Com liberações em datas diferentes, a nota diz quando TUDO estará liberado (a data mais próxima sozinha parecia valer para tudo).
  if (pending !== null && pending > 0 && data.nextReleaseAt) {
    const last = data.lastReleaseAt ?? null;
    pendingNotes.push(last && last !== data.nextReleaseAt
      ? t('profit.equation.pendingNoteAll', { date: formatDate(last, locale) })
      : t('profit.equation.pendingNote', { date: formatDate(data.nextReleaseAt, locale) }));
  }
  if (pending === null && data.counts.pendingSales > 0) pendingNotes.push(t('profit.summary.pendingUnavailable'));

  const withdrawalNotes = [t('profit.equation.withdrawalsNote')];
  if (data.counts.withdrawalsWithoutFee > 0) withdrawalNotes.push(tPlural('profit.summary.withdrawalsWithoutFee', data.counts.withdrawalsWithoutFee));

  const depositNotes: string[] = [];
  if (depositFeeCents > 0) depositNotes.push(t('profit.equation.depositedNote', { value: moneyLine({ cents: depositFeeCents }) }));
  if (data.counts.legacyDeposits > 0) depositNotes.push(tPlural('profit.summary.legacyDeposits', data.counts.legacyDeposits));

  const rows: EquationRow[] = [
    {
      label: t('profit.equation.withdrawals'),
      note: withdrawalNotes.join(' · '),
      value: money(data.withdrawalsNetUsdCents, data.approx.withdrawals, data.estimatedParts.withdrawals),
    },
    {
      op: '+',
      label: t('profit.equation.available'),
      value: money(data.platformBalanceUsdCents, data.approx.platformBalance, data.estimatedParts.platformBalance),
    },
    {
      op: '+',
      label: t('profit.equation.pending'),
      note: (
        <span className={styles.pendingLabel}>
          <Badge tone="pending" icon="hourglass">{t('profit.equation.pendingBadge')}</Badge>
          {pendingNotes.join(' · ')}
        </span>
      ),
      value: money(pending, data.approx.pendingBalance, data.estimatedParts.pendingBalance),
    },
    {
      op: '+',
      label: t('profit.equation.stock'),
      value: money(data.stockUsdCents, data.approx.stock, data.estimatedParts.stock),
    },
    {
      variant: 'sub',
      label: t('profit.summary.stockForSale'),
      value: money(data.stockBreakdown.forSale.usdCents, data.stockBreakdown.forSale.approx, data.stockBreakdown.forSale.estimated),
    },
    {
      variant: 'sub',
      label: t('profit.summary.stockOffSale'),
      value: money(data.stockBreakdown.offSale.usdCents, data.stockBreakdown.offSale.approx, data.stockBreakdown.offSale.estimated),
    },
    {
      op: '−',
      label: t('profit.equation.deposited'),
      note: depositNotes.length > 0 ? depositNotes.join(' · ') : undefined,
      value: money(data.depositsUsdCents, data.approx.deposits, data.estimatedParts.deposits),
    },
    {
      op: '=',
      variant: 'result',
      label: t('profit.equation.result'),
      value: (
        <Money
          size="xl"
          align="end"
          signed
          cents={data.realProfitUsdCents}
          estimated={data.estimated}
          approxCents={data.approx.realProfit}
          approxCurrency={data.approxCurrency}
          staleRateNote={staleRateNote}
        />
      ),
    },
  ];

  const isEmpty =
    data.counts.deposits === 0 && data.counts.withdrawals === 0 && data.counts.stockItems === 0 &&
    data.balancesByStore.every((row) => row.lastCheck === null && row.pending.count === 0 && row.availableCents === 0);
  const fxText = displayFx && !isUsd && displayFx.rate !== null
    ? describeFxRate(
        { rate: displayFx.rate, currency: displayFx.currency, source: displayFx.source, quotedAt: displayFx.quotedAt, updatedAt: displayFx.updatedAt },
        locale,
        tLoose,
      )
    : null;

  return (
    <Panel title={t('profit.equation.title')} hint={t('profit.equation.hint')} className={styles.panel}>
      <div className={styles.stack}>
        <Equation rows={rows} />

        {data.warnings.length > 0 && (
          <Banner tone="warning" announce={false}>
            <ul className={styles.warnings}>
              {data.warnings.map((warning, index) => {
                const message = tLoose(`warnings.${warning.code}`);
                return (
                  <li key={`${warning.source}-${warning.storeId ?? 'x'}-${warning.code}-${index}`}>
                    {warning.source === 'STORE' && warning.storeName
                      ? t('profit.summary.warningStore', { store: warning.storeName, message })
                      : warning.source === 'DEPOSITS'
                        ? t('profit.summary.warningDeposits', { message })
                        : warning.source === 'WITHDRAWALS'
                          ? t('profit.summary.warningWithdrawals', { message })
                          : t('profit.summary.warningStock', { message })}
                  </li>
                );
              })}
            </ul>
          </Banner>
        )}

        {!isUsd && <p className={styles.note}>{fxText ? t('profit.estimatedNote', { fx: fxText }) : t('profit.estimatedNoFx')}</p>}

        {isEmpty && <EmptyState icon="profit" title={t('profit.emptyHint')} />}
      </div>
    </Panel>
  );
}
