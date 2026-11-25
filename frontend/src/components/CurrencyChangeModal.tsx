'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { currencyChangeView } from '@/lib/currencyChange';
import { currencyName } from '@/lib/currencies';
import { queryKeys } from '@/lib/queryKeys';
import { getCurrencyChangePreview } from '@/services/api';
import forms from './forms.module.css';
import Modal from './Modal';
import { usePreferences } from './PreferencesProvider';

interface Props {
  // Moeda escolhida no seletor (ainda não gravada).
  currency: string;
  onClose: () => void;
}

// "euro (EUR)": o nome no idioma atual seguido do código; sem nome, só o código.
export function currencyShortName(code: string, locale: string): string {
  const name = currencyName(code, locale);
  return name === code ? code : `${name} (${code})`;
}

// Confirmação antes de trocar a moeda de conversão (D369 R4, E-P3-Q18/Q19): modal pequeno e centralizado que explica que os valores
// convertidos mudam com a cotação e que o saldo e o lucro são sempre contados em dólar. Só grava ao confirmar. A prévia vem do backend;
// as linhas da loja Steam (11.4) entram em `view.steamLines` sem mudar o resto.
export default function CurrencyChangeModal({ currency, onClose }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const { changeDisplayCurrency, refreshFxRate } = usePreferences();
  const preview = useQuery({
    queryKey: queryKeys.settings.currencyPreview(currency),
    queryFn: ({ signal }) => getCurrencyChangePreview(currency, signal),
    // A prévia é uma foto do momento da escolha: não recarrega sozinha enquanto o modal está aberto.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const view = currencyChangeView(preview.data ?? null, currency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = currencyShortName(currency, locale);

  const confirm = () => {
    setBusy(true);
    setError(null);
    changeDisplayCurrency(currency, view.steamStore)
      .then(async () => {
        // Sem cotação da moeda nova e com fonte automática: busca na hora. Falha não desfaz a troca (o "≈" só aparece com cotação).
        if (view.fetchRateAfter) await refreshFxRate(currency).catch(() => undefined);
        onClose();
      })
      .catch((err: unknown) => {
        setError(errorMessageFor(err, tLoose, locale));
        setBusy(false);
      });
  };

  return (
    <Modal title={t('currency.modal.title', { currency: label })} onClose={onClose} busy={busy}>
      <div className={forms.form}>
        <p>{view.toBase ? t('currency.modal.bodyBase') : t('currency.modal.body', { currency: label })}</p>
        {view.noRate === 'AUTO' && <p className={forms.hint} role="status">{t('currency.modal.noRateAuto', { currency: label })}</p>}
        {view.noRate === 'MANUAL' && <p className={forms.hint} role="status">{t('currency.modal.noRateManual', { currency: label })}</p>}
        {preview.isError && (
          <p className={forms.hint} role="status">
            {t('currency.modal.previewError', { reason: errorMessageFor(preview.error, tLoose, locale) })}
          </p>
        )}
        {error && <div className={forms.topError} role="alert">{error}</div>}
        <div className={forms.actions}>
          <button type="button" className={forms.button} onClick={onClose} disabled={busy} autoFocus>
            {t('common.cancel')}
          </button>
          <button type="button" className={`${forms.button} ${forms.primary}`} onClick={confirm} disabled={busy || preview.isPending}>
            {busy ? t('common.saving') : t('currency.modal.confirm', { currency })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
