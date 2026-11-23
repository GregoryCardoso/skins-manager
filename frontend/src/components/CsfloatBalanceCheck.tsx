'use client';

import { useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDateTime, formatMoney } from '@/lib/format';
import { checkCsfloatBalance, explainCsfloatBalance } from '@/services/api';
import type { CsfloatBalanceCheckResult, CsfloatBalanceExplanation } from '@/types/api';
import styles from './CsfloatBalanceCheck.module.css';

interface Props {
  // Abre a conferência da 8.6 com o saldo real do CSFloat já preenchido (o usuário decide se registra e se ajusta).
  onRegister: (balanceCents: number) => void;
}

// "Conferir com o CSFloat" (9.7, D313): só leitura e sob demanda. Compara o saldo calculado da loja com o do CSFloat, separa o que
// está "em trânsito" e, se pedido, explica a diferença pelo extrato. Nunca grava nada.
export default function CsfloatBalanceCheck({ onRegister }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const language = useLanguage();
  const [busy, setBusy] = useState<'check' | 'explain' | null>(null);
  const [result, setResult] = useState<CsfloatBalanceCheckResult | null>(null);
  const [explanation, setExplanation] = useState<CsfloatBalanceExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const usd = (cents: number) => formatMoney(cents, 'USD', language);
  const signed = (cents: number) => `${cents > 0 ? '+' : ''}${usd(cents)}`;

  const runCheck = () => {
    setBusy('check');
    setError(null);
    setExplanation(null);
    checkCsfloatBalance()
      .then(setResult)
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, language)))
      .finally(() => setBusy(null));
  };
  const runExplain = () => {
    setBusy('explain');
    setError(null);
    explainCsfloatBalance()
      .then(setExplanation)
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, language)))
      .finally(() => setBusy(null));
  };

  const diff = result?.difference;
  const inTransit = result?.inTransit;
  return (
    <div className={styles.box} data-testid="csfloat-balance-check">
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={runCheck} disabled={busy !== null}>
          {busy === 'check' ? t('balanceCheck.checking') : t(result ? 'balanceCheck.again' : 'balanceCheck.button')}
        </button>
        {result && (
          <button type="button" className={styles.button} onClick={runExplain} disabled={busy !== null}>
            {busy === 'explain' ? t('balanceCheck.explaining') : t('balanceCheck.explain')}
          </button>
        )}
        {result && result.csfloat.balanceCents !== null && (
          <button type="button" className={styles.button} onClick={() => onRegister(result.csfloat.balanceCents as number)} disabled={busy !== null}>
            {t('balanceCheck.register')}
          </button>
        )}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}

      {result && diff && inTransit && (
        <div role="status" className={result.explained ? styles.ok : styles.warn}>
          <p className={styles.title}>
            {result.explained
              ? t('balanceCheck.matches')
              : t('balanceCheck.differs', { available: signed(diff.availableCents ?? 0), pending: signed(diff.pendingCents ?? 0) })}
          </p>
          <p className={styles.line}>
            {t('balanceCheck.csfloat', {
              available: result.csfloat.balanceCents === null ? '—' : usd(result.csfloat.balanceCents),
              pending: result.csfloat.pendingBalanceCents === null ? '—' : usd(result.csfloat.pendingBalanceCents),
            })}
          </p>
          <p className={styles.line}>{t('balanceCheck.app', { available: usd(result.store.availableCents), pending: usd(result.store.pendingCents) })}</p>
          {(inTransit.purchasesCents > 0 || inTransit.salesPendingCents > 0 || inTransit.openBidsCents > 0) && (
            <p className={styles.line}>
              {t('balanceCheck.inTransit', {
                purchases: usd(inTransit.purchasesCents), sales: usd(inTransit.salesPendingCents), bids: usd(inTransit.openBidsCents),
              })}
            </p>
          )}
          {result.feeCheck.saleFeeMatches === false && <p className={styles.line}>{t('balanceCheck.saleFeeDiffers')}</p>}
          <p className={styles.muted}>{t('balanceCheck.checkedAt', { date: formatDateTime(result.checkedAt, language) })}</p>
        </div>
      )}

      {explanation && (
        <div className={styles.explain} data-testid="csfloat-balance-explain">
          <p className={styles.title}>
            {tPlural('balanceCheck.explainTitle', explanation.transactionsRead)}
          </p>
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
          <p className={styles.muted}>{t('balanceCheck.explainHint')}</p>
        </div>
      )}
    </div>
  );
}
