'use client';

import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { isoToLocalInput, localInputToIso } from '@/lib/dateInput';
import { formatDateTime, formatMoney } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { previewCutoffChange } from '@/services/api';
import CutoffTimeline from './imports/CutoffTimeline';
import styles from './imports/importModals.module.css';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import Disclosure from './ui/Disclosure';
import TextField from './ui/TextField';

interface Props {
  currentCutoffAt: string | null;
  busy: boolean;
  error: string | null;
  onConfirm: (cutoffAt: string) => void;
  onCancel: () => void;
}

const FORM_ID = 'cutoff-change-form';

// Mudar a data de corte (9.5.1c, D325; 12.9): a data nova, a linha do tempo comparando a atual e a nova, a pré-visualização do efeito
// (sem rede) e a confirmação. Uma só data de corte (Revisão 28): vale para compras, vendas, aportes e saques. Ao confirmar, o app roda
// uma importação manual com varredura completa; o corte só é gravado se a leitura der certo.
export default function CutoffChangeModal({ currentCutoffAt, busy, error, onConfirm, onCancel }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const [text, setText] = useState(currentCutoffAt ? isoToLocalInput(currentCutoffAt) : '');
  const iso = localInputToIso(text);
  const changed = iso !== null && (currentCutoffAt === null || Date.parse(iso) !== Date.parse(currentCutoffAt));
  const future = iso !== null && Date.parse(iso) > Date.now();

  const previewQuery = useQuery({
    queryKey: queryKeys.imports.cutoffPreview(iso),
    queryFn: ({ signal }) => previewCutoffChange(iso as string, signal),
    enabled: changed && !future,
    gcTime: 0,
  });
  const preview = changed && !future ? previewQuery.data ?? null : null;
  const transfers = preview?.transfers ?? null;
  const usd = (cents: number) => formatMoney(cents, 'USD', locale);

  // Quantos trades mudam de lado: recuar = os que passam a entrar; avançar = os que saem (abertos que se fecham).
  const moves = preview?.backward
    ? preview.backward.purchases.count + preview.backward.sales.count + (transfers ? transfers.deposits.count + transfers.withdrawals.count : 0)
    : preview?.forward
      ? preview.forward.openToClose + (transfers?.openToClose ?? 0)
      : null;

  const dateError = iso === null && text !== '' ? t('imports.launch.dateInvalid') : future ? tLoose('errors.DATE_IN_FUTURE') : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (iso && changed && !future) onConfirm(iso);
  };

  return (
    <Dialog
      title={t('imports.cutoffChange.title')}
      size="lg"
      onClose={onCancel}
      busy={busy}
      footer={(
        <>
          <Button onClick={onCancel} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={busy} disabled={!changed || future || iso === null}>
            {busy ? t('imports.running') : t('imports.cutoffChange.confirm')}
          </Button>
        </>
      )}
    >
      <form id={FORM_ID} className={styles.form} onSubmit={submit} noValidate>
        {currentCutoffAt && <p>{t('imports.cutoffChange.current', { date: formatDateTime(currentCutoffAt, locale) })}</p>}
        <TextField label={t('imports.cutoffChange.newDate')} type="datetime-local" value={text} onChange={setText} error={dateError} disabled={busy} autoFocus full />
        <CutoffTimeline current={currentCutoffAt} next={iso !== null && !future ? iso : null} moves={moves} />
        <Disclosure label={t('imports.cutoffChange.howItWorks')}>
          <div className={styles.stack}>
            <p className={styles.help}>{t('imports.cutoffChange.singleHint')}</p>
            <ul className={styles.list}>
              <li>{t('imports.cutoffChange.backwardHelp')}</li>
              <li>{t('imports.cutoffChange.forwardHelp')}</li>
              <li>{t('imports.cutoffChange.undoHelp')}</li>
            </ul>
          </div>
        </Disclosure>

        {changed && !future && previewQuery.isFetching && <p className={styles.muted}>{t('common.loading')}</p>}
        {previewQuery.error !== null && changed && <Banner tone="danger">{errorMessageFor(previewQuery.error, tLoose, locale)}</Banner>}
        {preview?.backward && (
          <div className={styles.stack} role="status" data-testid="cutoff-preview-backward">
            <p><strong>{t('imports.cutoffChange.previewTitle')}</strong></p>
            <p>{tPlural('imports.cutoffChange.upToPurchases', preview.backward.purchases.count, { value: usd(preview.backward.purchases.amountCents) })}</p>
            <p>{tPlural('imports.cutoffChange.upToSales', preview.backward.sales.count, { value: usd(preview.backward.sales.amountCents) })}</p>
            {transfers && (
              <>
                <p>{tPlural('imports.transferCutoff.upToDeposits', transfers.deposits.count, { value: usd(transfers.deposits.amountCents) })}</p>
                <p>{tPlural('imports.transferCutoff.upToWithdrawals', transfers.withdrawals.count, { value: usd(transfers.withdrawals.amountCents) })}</p>
              </>
            )}
            {preview.backward.mayHaveUnseen && <p>{t('imports.cutoffChange.mayHaveUnseen')}</p>}
            {(preview.backward.manualLaunches.purchases + preview.backward.manualLaunches.sales) > 0 && (
              <p>{t('imports.cutoffChange.manualLaunches', {
                purchases: tPlural('imports.cutoffChange.purchasesCount', preview.backward.manualLaunches.purchases),
                sales: tPlural('imports.cutoffChange.salesCount', preview.backward.manualLaunches.sales),
              })}</p>
            )}
            {preview.backward.deposits.length > 0 && (
              <Banner tone="warning">
                <p>{tPlural('imports.cutoffChange.depositsWarning', preview.backward.deposits.length)}</p>
                <ul className={styles.list}>
                  {preview.backward.deposits.map((d) => (
                    <li key={d.id}>{formatDateTime(d.depositedAt, locale)}{d.amountStoreCents !== null ? ` — ${usd(d.amountStoreCents)}` : ''}</li>
                  ))}
                </ul>
              </Banner>
            )}
          </div>
        )}
        {preview?.forward && (
          <div className={styles.stack} role="status" data-testid="cutoff-preview-forward">
            <p><strong>{t('imports.cutoffChange.previewTitle')}</strong></p>
            <p>{tPlural('imports.cutoffChange.importedKept', preview.forward.importedKept)}</p>
            <p>{tPlural('imports.cutoffChange.openToClose', preview.forward.openToClose)}</p>
            {transfers && transfers.openToClose > 0 && <p>{tPlural('imports.transferCutoff.openToClose', transfers.openToClose)}</p>}
          </div>
        )}

        {error && <Banner tone="danger">{error}</Banner>}
      </form>
    </Dialog>
  );
}
