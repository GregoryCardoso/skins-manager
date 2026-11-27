'use client';

import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { storeCounterpart } from '@/lib/baseMoney';
import { formatDate, formatMoney } from '@/lib/format';
import type { StoreBalanceSummary } from '@/types/api';
import styles from './StoreBalanceRow.module.css';
import Badge from './ui/Badge';
import BalanceBar from './ui/BalanceBar';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Disclosure from './ui/Disclosure';
import HelpTip from './ui/HelpTip';
import Menu, { type MenuEntry } from './ui/Menu';
import Money from './ui/Money';
import { useBelow } from './ui/useMediaQuery';
import VisuallyHidden from './ui/VisuallyHidden';

interface Props {
  store: StoreBalanceSummary;
  // O saldo que corresponde à barra cheia (maior total entre as lojas, em US$); ver `balanceBarScale`.
  scaleMaxCents: number;
  // Os botões de aporte e saque só aparecem se a loja aceita (aporte: loja em US$ ativa; saque: loja que permite saque).
  canDeposit: boolean;
  canWithdraw: boolean;
  onDeposit: (store: StoreBalanceSummary) => void;
  onWithdraw: (store: StoreBalanceSummary) => void;
  onCheck: (store: StoreBalanceSummary) => void;
  onHistory: (store: StoreBalanceSummary) => void;
  // Texto pronto de "cotação velha" (a partir da regra `isFxRateStale`), junto do "≈" do saldo.
  staleRateNote?: string;
}

// Uma loja no painel "Saldo nas lojas" (12.7b): nome, moeda, selos, saldo disponível com "≈", a barra (disponível e pendente listrado),
// rodapé com o pendente e a última conferência, avisos, ações e o "Detalhes do cálculo". Todos os valores vêm prontos do backend.
export default function StoreBalanceRow({ store, scaleMaxCents, canDeposit, canWithdraw, onDeposit, onWithdraw, onCheck, onHistory, staleRateNote }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const compact = useBelow('compact');
  const { pending, breakdown, ignored } = store;
  const fxMissing = store.warningCode === 'FX_NOT_CONFIGURED';
  const counterpart = storeCounterpart({
    currency: store.currency, usdCents: store.availableUsdCents, approxCents: store.availableApproxCents, approxCurrency: store.approxCurrency,
  });
  const detailLines = [
    ['deposits', breakdown.depositsCents],
    ['purchases', -breakdown.purchasesCents],
    ['withdrawals', -breakdown.withdrawalsCents],
    ['salesReleased', breakdown.salesReleasedCents],
    ['adjustments', breakdown.adjustmentsCents],
  ] as const;

  // "R$ X pendente" e, no "?" (abre também ao passar o mouse), quanto libera em cada data. Antes a linha trazia só a data mais
  // próxima, e parecia que tudo liberava nela (relato do usuário, 12.12).
  const releases = pending.releases ?? (pending.nextReleaseAt ? [{ releaseAt: pending.nextReleaseAt, cents: pending.cents, count: pending.count }] : []);
  const pendingText = pending.cents > 0
    ? t('storeBalances.row.pendingShort', { value: formatMoney(pending.cents, store.currency, locale) })
    : t('storeBalances.row.noPending');
  const pendingHelp = pending.cents > 0 && releases.length > 0 ? (
    <HelpTip topic={t('storeBalances.row.releasesTopic')} icon="clock" openOnHover>
      <ul className={styles.releases}>
        {releases.map((release) => (
          <li key={release.releaseAt}>
            {tPlural('storeBalances.row.releaseLine', release.count, {
              date: formatDate(release.releaseAt, locale),
              value: formatMoney(release.cents, store.currency, locale),
            })}
          </li>
        ))}
      </ul>
    </HelpTip>
  ) : null;

  // Faixa compacta (< 900): só "Conferir" fica no cartão; o resto vai para o Menu ⋯.
  const menuItems: MenuEntry[] = [];
  if (compact) {
    if (canDeposit) menuItems.push({ id: 'deposit', label: t('storeBalances.row.deposit'), onSelect: () => onDeposit(store) });
    if (canWithdraw) menuItems.push({ id: 'withdraw', label: t('storeBalances.row.withdraw'), onSelect: () => onWithdraw(store) });
  }
  menuItems.push({ id: 'history', label: t('storeBalances.history.open'), onSelect: () => onHistory(store) });

  return (
    <li className={`${styles.row} ${store.isActive ? '' : styles.inactive}`} data-store-id={store.storeId}>
      <div className={styles.head}>
        <strong className={styles.name}>{store.storeName}</strong>
        <Badge tone="neutral">
          <VisuallyHidden>{t('storeBalances.row.currencyTag', { currency: store.currency })}</VisuallyHidden>
          <span aria-hidden="true">{store.currency}</span>
        </Badge>
        {!store.isActive && <Badge tone="neutral">{t('storeBalances.inactive')}</Badge>}
        {!store.allowsWithdrawal && <Badge tone="info">{t('storeBalances.nonWithdrawable')}</Badge>}
      </div>

      <div className={styles.balance}>
        <span className={store.negative ? styles.negative : undefined}>
          <Money
            size="lg"
            cents={store.availableCents}
            currency={store.currency}
            approxCents={counterpart?.cents ?? null}
            approxCurrency={counterpart?.currency ?? null}
            staleRateNote={staleRateNote}
          />
        </span>
        <span className={styles.availableLabel}>{t('storeBalances.available')}</span>
      </div>

      <BalanceBar
        availableCents={store.availableUsdCents ?? 0}
        pendingCents={pending.usdCents ?? 0}
        scaleMaxCents={scaleMaxCents}
        availableText={formatMoney(store.availableCents, store.currency, locale)}
        pendingText={formatMoney(pending.cents, store.currency, locale)}
      />

      <p className={styles.foot}>
        <span className={styles.pending}>
          {pendingText}
          {pendingHelp}
        </span>
      </p>

      {fxMissing && (
        <Banner tone="warning" announce={false} action={{ label: t('inventory.warnings.goToSettings'), href: '/settings/' }}>
          {tLoose('warnings.FX_NOT_CONFIGURED')}
        </Banner>
      )}
      {store.negative && <Banner tone="warning" announce={false}>{tLoose('warnings.COMPUTED_BALANCE_NEGATIVE')}</Banner>}
      {ignored.legacyDeposits > 0 && <p className={styles.note}>{tPlural('storeBalances.legacyDepositsIgnored', ignored.legacyDeposits)}</p>}
      {ignored.currencyMismatch > 0 && <p className={styles.note}>{tPlural('storeBalances.currencyMismatchIgnored', ignored.currencyMismatch)}</p>}

      <div className={styles.actions}>
        <Button size="sm" onClick={() => onCheck(store)}>{t('storeBalances.check')}</Button>
        {!compact && canDeposit && (
          <Button size="sm" icon="plus" iconOnlyBelow="narrow" onClick={() => onDeposit(store)}>{t('storeBalances.row.deposit')}</Button>
        )}
        {!compact && canWithdraw && (
          <Button size="sm" icon="wallet" iconOnlyBelow="narrow" onClick={() => onWithdraw(store)}>{t('storeBalances.row.withdraw')}</Button>
        )}
        <Menu label={t('storeBalances.row.more', { store: store.storeName })} items={menuItems} />
      </div>

      <Disclosure label={t('storeBalances.row.detailsLabel')}>
        <dl className={styles.breakdown} aria-label={t('storeBalances.breakdown.title')}>
          {detailLines.map(([key, cents]) => (
            <div key={key} className={styles.breakdownLine}>
              <dt>{t(`storeBalances.breakdown.${key}`)}</dt>
              <dd>{formatMoney(cents, store.currency, locale)}</dd>
            </div>
          ))}
        </dl>
      </Disclosure>
    </li>
  );
}
