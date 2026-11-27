'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { currencyChangeView, initialSteamChecks, steamChoiceFor } from '@/lib/currencyChange';
import { currencyName } from '@/lib/currencies';
import { boundsFor, boundsParams, isOutOfBounds } from '@/lib/fxBounds';
import { parseDecimalInput } from '@/lib/numberInput';
import { queryKeys } from '@/lib/queryKeys';
import { getCurrencyChangePreview, getSettings } from '@/services/api';
import styles from './CurrencyChangeModal.module.css';
import { usePreferences } from './PreferencesProvider';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Checkbox from './ui/Checkbox';
import Dialog from './ui/Dialog';
import NumberField from './ui/NumberField';

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
// as linhas da loja Steam (11.4) vêm de `view.steamLines`. Sem cotação gravada para a moeda e sem fonte automática, o modal aceita
// digitar a cotação ali mesmo (opcional); o mesmo campo reaparece se a busca automática falhar depois da troca (12.8).
export default function CurrencyChangeModal({ currency, onClose }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const { changeDisplayCurrency, refreshFxRate, saveFxRate } = usePreferences();
  const preview = useQuery({
    queryKey: queryKeys.settings.currencyPreview(currency),
    queryFn: ({ signal }) => getCurrencyChangePreview(currency, signal),
    // A prévia é uma foto do momento da escolha: não recarrega sozinha enquanto o modal está aberto.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const settings = useQuery({ queryKey: queryKeys.settings.all, queryFn: ({ signal }) => getSettings(signal) });
  const bounds = boundsFor(settings.data?.fxManualRateBounds, currency);
  const view = currencyChangeView(preview.data ?? null, currency);
  // Caixas da loja Steam (11.4): FOLLOW marcada por padrão; NEW_STORE desmarcada. `null` = ainda não mexeu: vale o padrão da prévia.
  const [steamChecks, setSteamChecks] = useState<Record<string, boolean> | null>(null);
  const checks = steamChecks ?? initialSteamChecks(view);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateText, setRateText] = useState('');
  // A troca já foi gravada, mas a busca automática da cotação falhou: o campo da cotação reaparece.
  const [fetchFailed, setFetchFailed] = useState(false);
  const label = currencyShortName(currency, locale);

  const rate = parseDecimalInput(rateText, locale);
  const showRateField = view.noRate === 'MANUAL' || fetchFailed;
  const outOfBounds = isOutOfBounds(rate, bounds);

  // Grava só a cotação digitada (nada muda se ela for recusada: o erro aparece no campo).
  const saveRate = async (): Promise<boolean> => {
    if (rate === null) return true;
    try {
      await saveFxRate(currency, rate);
      return true;
    } catch (err) {
      setRateError(errorMessageFor(err, tLoose, locale));
      return false;
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    setRateError(null);
    if (fetchFailed) {
      // A troca já está gravada: aqui só se salva a cotação digitada.
      if (rate !== null && !(await saveRate())) {
        setBusy(false);
        return;
      }
      onClose();
      return;
    }
    // 1. Cotação digitada primeiro (ver P7): recusada = nada muda.
    if (showRateField && rate !== null && !(await saveRate())) {
      setBusy(false);
      return;
    }
    // 2. A troca.
    try {
      await changeDisplayCurrency(currency, steamChoiceFor(view, checks));
    } catch (err) {
      setError(errorMessageFor(err, tLoose, locale));
      setBusy(false);
      return;
    }
    // 3. Sem cotação da moeda nova e com fonte automática: busca na hora. Falha não desfaz a troca (o "≈" só aparece com cotação).
    if (view.fetchRateAfter) {
      try {
        await refreshFxRate(currency);
      } catch {
        setFetchFailed(true);
        setBusy(false);
        return;
      }
    }
    onClose();
  };

  return (
    <Dialog
      title={t('currency.modal.title', { currency: label })}
      size="sm"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {fetchFailed ? t('common.close') : t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={preview.isPending} onClick={() => void confirm()}>
            {fetchFailed ? t('settings.fx.save') : t('currency.modal.confirm', { currency })}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        {!fetchFailed && <p className={styles.text}>{view.toBase ? t('currency.modal.bodyBase') : t('currency.modal.body', { currency: label })}</p>}
        {fetchFailed && <Banner tone="warning">{t('currency.modal.fetchFailed', { currency: label })}</Banner>}
        {!fetchFailed && view.steamLines.map((line) => {
          if (line.kind === 'LOCKED_INFO') {
            return <p key={line.kind} className={styles.hint} role="status">{t('currency.modal.steamLocked', { from: view.steamCurrency ?? '' })}</p>;
          }
          return (
            <Checkbox
              key={line.kind}
              checked={checks[line.kind] === true}
              disabled={busy}
              onChange={(checked) => setSteamChecks({ ...checks, [line.kind]: checked })}
              label={line.kind === 'FOLLOW' ? t('currency.modal.steamFollow', { currency }) : t('currency.modal.steamNewStore', { currency })}
              hint={line.kind === 'NEW_STORE' ? t('currency.modal.steamNewStoreHint', { from: view.steamCurrency ?? '' }) : undefined}
            />
          );
        })}
        {!fetchFailed && view.steamFeesZeroed && (checks.FOLLOW === true || checks.NEW_STORE === true) && (
          <p className={styles.hint} role="status">{t('currency.modal.steamFeesZeroed', { currency: currencyShortName(view.steamFeesMissingCurrency ?? currency, locale) })}</p>
        )}
        {!fetchFailed && view.noRate === 'AUTO' && <p className={styles.hint} role="status">{t('currency.modal.noRateAuto', { currency: label })}</p>}
        {!fetchFailed && view.noRate === 'MANUAL' && <p className={styles.hint} role="status">{t('currency.modal.noRateManual', { currency: label })}</p>}
        {showRateField && (
          <NumberField
            kind="decimal"
            label={t('currency.modal.rateLabel', { currency })}
            name="rate"
            value={rateText}
            disabled={busy}
            error={rateError}
            hint={
              <>
                {!fetchFailed && <span className={styles.line}>{t('currency.modal.rateOptional')}</span>}
                {bounds && <span className={styles.line}>{t('settings.fx.boundsHint', boundsParams(bounds, locale))}</span>}
                {bounds && outOfBounds && <span className={`${styles.line} ${styles.warn}`}>{t('settings.fx.outOfBounds', boundsParams(bounds, locale))}</span>}
              </>
            }
            onValueChange={(text) => {
              setRateText(text);
              setRateError(null);
            }}
          />
        )}
        {preview.isError && (
          <p className={styles.hint} role="status">
            {t('currency.modal.previewError', { reason: errorMessageFor(preview.error, tLoose, locale) })}
          </p>
        )}
        {error && <Banner tone="danger">{error}</Banner>}
      </div>
    </Dialog>
  );
}
