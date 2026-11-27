'use client';

import { useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDateTime, formatMoney } from '@/lib/format';
import { checkCsfloatBalance, explainCsfloatBalance } from '@/services/api';
import type { CsfloatBalanceCheckResult, CsfloatBalanceExplanation } from '@/types/api';
import styles from './moneyForms.module.css';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Disclosure from './ui/Disclosure';

interface Props {
  // Passa o saldo do CSFloat para o campo "saldo no site" do passo 1 da conferência (o usuário decide se registra e se ajusta).
  onUseBalance: (balanceCents: number) => void;
}

// "Conferir com o CSFloat" (9.7, D313; 12.7b): bloco do passo 1 da conferência. Só leitura e sob demanda. Compara o saldo calculado da
// loja com o do CSFloat, separa o que está "em trânsito" e, se pedido (Disclosure), explica a diferença pelo extrato. Nunca grava nada.
export default function CsfloatBalanceCheck({ onUseBalance }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const [busy, setBusy] = useState<'check' | 'explain' | null>(null);
  const [result, setResult] = useState<CsfloatBalanceCheckResult | null>(null);
  const [explanation, setExplanation] = useState<CsfloatBalanceExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const usd = (cents: number) => formatMoney(cents, 'USD', locale);
  const signed = (cents: number) => `${cents > 0 ? '+' : ''}${usd(cents)}`;

  const runCheck = () => {
    setBusy('check');
    setError(null);
    setExplanation(null);
    checkCsfloatBalance()
      .then(setResult)
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, locale)))
      .finally(() => setBusy(null));
  };
  const runExplain = () => {
    setBusy('explain');
    setError(null);
    explainCsfloatBalance()
      .then(setExplanation)
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, locale)))
      .finally(() => setBusy(null));
  };

  const diff = result?.difference;
  const inTransit = result?.inTransit;
  return (
    <div className={styles.csfloat} data-testid="csfloat-balance-check">
      <div className={styles.csfloatActions}>
        <Button size="sm" loading={busy === 'check'} disabled={busy === 'explain'} onClick={runCheck}>
          {busy === 'check' ? t('balanceCheck.checking') : t(result ? 'balanceCheck.again' : 'balanceCheck.button')}
        </Button>
        {result && result.csfloat.balanceCents !== null && (
          <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => onUseBalance(result.csfloat.balanceCents as number)}>
            {t('storeBalances.checkDialog.useCsfloat')}
          </Button>
        )}
      </div>
      {error && <Banner tone="danger">{error}</Banner>}

      {result && diff && inTransit && (
        <Banner tone={result.explained ? 'success' : 'warning'} announce={false}>
          <div className={styles.csfloatBody}>
            <p><strong>
              {result.explained
                ? t('balanceCheck.matches')
                : t('balanceCheck.differs', { available: signed(diff.availableCents ?? 0), pending: signed(diff.pendingCents ?? 0) })}
            </strong></p>
            <p>
              {t('balanceCheck.csfloat', {
                available: result.csfloat.balanceCents === null ? '—' : usd(result.csfloat.balanceCents),
                pending: result.csfloat.pendingBalanceCents === null ? '—' : usd(result.csfloat.pendingBalanceCents),
              })}
            </p>
            <p>{t('balanceCheck.app', { available: usd(result.store.availableCents), pending: usd(result.store.pendingCents) })}</p>
            {(inTransit.purchasesCents > 0 || inTransit.salesPendingCents > 0 || inTransit.openBidsCents > 0) && (
              <p>
                {t('balanceCheck.inTransit', {
                  purchases: usd(inTransit.purchasesCents), sales: usd(inTransit.salesPendingCents), bids: usd(inTransit.openBidsCents),
                })}
              </p>
            )}
            {result.feeCheck.saleFeeMatches === false && <p>{t('balanceCheck.saleFeeDiffers')}</p>}
            <p className={styles.small}>{t('balanceCheck.checkedAt', { date: formatDateTime(result.checkedAt, locale) })}</p>
          </div>
        </Banner>
      )}

      {result && (
        <Disclosure label={t('balanceCheck.explain')}>
          <div className={styles.stack} data-testid="csfloat-balance-explain">
            <div>
              <Button size="sm" loading={busy === 'explain'} disabled={busy === 'check'} onClick={runExplain}>
                {busy === 'explain' ? t('balanceCheck.explaining') : t('balanceCheck.explain')}
              </Button>
            </div>
            {explanation && (
              <div className={styles.csfloatBody}>
                <p><strong>{tPlural('balanceCheck.explainTitle', explanation.transactionsRead)}</strong></p>
                {explanation.groups.length === 0 ? (
                  <p>{t('balanceCheck.nothingUnmatched')}</p>
                ) : (
                  <ul className={styles.groups}>
                    {explanation.groups.map((group) => (
                      <li key={`${group.reason}|${group.type}`}>
                        {tLoose(`balanceCheck.reasons.${group.reason}`)} — {tLoose(`balanceCheck.types.${group.type}`) === `balanceCheck.types.${group.type}` ? group.type : tLoose(`balanceCheck.types.${group.type}`)}
                        {': '}
                        {tPlural('balanceCheck.groupCount', group.count)}
                        {group.balanceCents !== 0 && ` · ${t('balanceCheck.groupBalance', { value: signed(group.balanceCents) })}`}
                        {group.pendingCents !== 0 && ` · ${t('balanceCheck.groupPending', { value: signed(group.pendingCents) })}`}
                      </li>
                    ))}
                  </ul>
                )}
                {explanation.openBidsCents > 0 && <p>{t('balanceCheck.openBids', { value: usd(explanation.openBidsCents) })}</p>}
                <p className={styles.small}>{t('balanceCheck.explainHint')}</p>
              </div>
            )}
          </div>
        </Disclosure>
      )}
    </div>
  );
}
