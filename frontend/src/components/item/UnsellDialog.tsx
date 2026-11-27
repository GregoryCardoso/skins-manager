'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatMoney } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { ApiRequestError, getUnsellPreview } from '@/services/api';
import type { ItemView, UnsellPreview } from '@/types/api';
import Banner from '../ui/Banner';
import ConfirmDialog from '../ui/ConfirmDialog';
import Spinner from '../ui/Spinner';
import styles from './item.module.css';

interface Props {
  item: ItemView;
  busy: boolean;
  // Erro do desfazer (o ConfirmDialog o mostra no rodapé do corpo).
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  // A prévia disse que o item sumiu ou já não está vendido (outra aba): o chamador fecha, atualiza as telas e avisa.
  onGone: () => void;
}

const GONE_CODES = ['ITEM_NOT_FOUND', 'ITEM_NOT_SOLD', 'ITEM_CONSUMED'];

// Texto do efeito: "US$ 12,00 (≈ R$ 65,20)". Só formata o que o backend calculou (sem conversão aqui, D74).
function amountText(preview: UnsellPreview, t: ReturnType<typeof useT>, locale: string): string {
  const currency = preview.storeCurrency ?? 'USD';
  const main = formatMoney(Math.abs(preview.balanceEffectCents), currency, locale);
  if (preview.approxCents === null || !preview.approxCurrency) return main;
  const approx = formatMoney(Math.abs(preview.approxCents), preview.approxCurrency, locale);
  return `${main} (${t('common.approx', { value: approx })})`;
}

// Desfazer venda com o efeito (12.6b, D370): mostra o que sai do saldo da loja (disponível ou pendente), se o saldo fica negativo e para
// onde o item volta. A prévia é só informação e é buscada a cada abertura; se falhar, o desfazer continua possível.
export default function UnsellDialog({ item, busy, error, onConfirm, onCancel, onGone }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const query = useQuery({
    queryKey: queryKeys.items.unsellPreview(item.id),
    queryFn: ({ signal }) => getUnsellPreview(item.id, signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const preview = query.data ?? null;
  const goneError = query.error instanceof ApiRequestError && GONE_CODES.includes(query.error.code);
  useEffect(() => {
    if (goneError) onGone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goneError]);

  const renderEffect = (data: UnsellPreview) => {
    const store = data.storeName ?? '';
    const currency = data.storeCurrency ?? 'USD';
    const noEffect = data.balanceEffectCents === 0 || data.storeName === null;
    const before = data.wasReleased ? data.availableBeforeCents : data.pendingBeforeCents;
    const after = data.wasReleased ? data.availableAfterCents : data.pendingAfterCents;
    return (
      <div className={styles.effect} aria-live="polite">
        {noEffect ? (
          <p>{t('unsell.effect.none')}</p>
        ) : (
          <>
            <p>
              <strong>{t(data.wasReleased ? 'unsell.effect.available' : 'unsell.effect.pending', { value: amountText(data, t, locale), store })}</strong>
            </p>
            <p className={styles.muted}>
              {t('unsell.effect.change', { before: formatMoney(before, currency, locale), after: formatMoney(after, currency, locale) })}
            </p>
            {/* Só quando o desfazer baixa o disponível para menos de zero (venda retida não mexe no disponível). */}
            {data.availableAfterCents < 0 && data.availableAfterCents < data.availableBeforeCents && <Banner tone="warning" announce={false}>{t('unsell.effect.negative')}</Banner>}
          </>
        )}
        {data.currencyMismatch && <p className={styles.muted}>{t('unsell.effect.currencyMismatch')}</p>}
        <p>{t(data.returnsTo === 'OFF_SALE' ? 'unsell.effect.returnsHolding' : 'unsell.effect.returnsForSale')}</p>
      </div>
    );
  };

  const details = query.isPending
    ? <Spinner size="sm" />
    : preview
      ? renderEffect(preview)
      : goneError
        ? null
        : (
          <Banner
            tone="warning"
            announce={false}
            onRetry={() => { void query.refetch(); }}
            retrying={query.isFetching}
          >
            {t('unsell.effect.loadError')}
            {query.error ? ` (${errorMessageFor(query.error, tLoose, locale)})` : ''}
          </Banner>
        );

  return (
    <ConfirmDialog
      title={t('confirm.unsellTitle')}
      message={t('confirm.unsellMessage')}
      confirmLabel={t('confirm.confirmUnsell')}
      details={details}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
