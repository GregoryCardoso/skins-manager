'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { currencyChangeView, initialSteamChecks, steamChoiceFor } from '@/lib/currencyChange';
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
// as linhas da loja Steam (11.4) vêm de `view.steamLines`.
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
  // Caixas da loja Steam (11.4): FOLLOW marcada por padrão; NEW_STORE desmarcada. `null` = ainda não mexeu: vale o padrão da prévia.
  const [steamChecks, setSteamChecks] = useState<Record<string, boolean> | null>(null);
  const checks = steamChecks ?? initialSteamChecks(view);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = currencyShortName(currency, locale);

  const confirm = () => {
    setBusy(true);
    setError(null);
    changeDisplayCurrency(currency, steamChoiceFor(view, checks))
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
        {view.steamLines.map((line) => {
          if (line.kind === 'LOCKED_INFO') {
            return <p key={line.kind} className={forms.hint} role="status">{t('currency.modal.steamLocked', { from: view.steamCurrency ?? '' })}</p>;
          }
          const id = `currency-steam-${line.kind}`;
          return (
            <div key={line.kind}>
              <label htmlFor={id} className={forms.row}>
                <input
                  id={id}
                  type="checkbox"
                  checked={checks[line.kind] === true}
                  disabled={busy}
                  onChange={(event) => setSteamChecks({ ...checks, [line.kind]: event.target.checked })}
                />
                {' '}
                {line.kind === 'FOLLOW' ? t('currency.modal.steamFollow', { currency }) : t('currency.modal.steamNewStore', { currency })}
              </label>
              {line.kind === 'NEW_STORE' && <p className={forms.hint}>{t('currency.modal.steamNewStoreHint', { from: view.steamCurrency ?? '' })}</p>}
            </div>
          );
        })}
        {view.steamFeesZeroed && (checks.FOLLOW === true || checks.NEW_STORE === true) && (
          <p className={forms.hint} role="status">{t('currency.modal.steamFeesZeroed', { currency: currencyShortName(view.steamFeesMissingCurrency ?? currency, locale) })}</p>
        )}
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
