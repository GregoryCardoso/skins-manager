'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { currencyLabel, moneyErrorParams } from '@/lib/currencies';
import { formatRate } from '@/lib/format';
import { describeFxRate } from '@/lib/fxDisplay';
import { buildFxRows, type FxRow } from '@/lib/fxRates';
import { formatDecimalInput, isAmbiguousDecimal, parseDecimalInput } from '@/lib/numberInput';
import type { FxRefreshSource } from '@/types/api';
import { usePreferences } from './PreferencesProvider';
import styles from './settings.module.css';

// Uma moeda: valor ("US$ 1 = …"), fonte e data, edição manual e "Atualizar cotação". A PTAX só aparece no BRL (D369 4.4).
function FxRateRow({ row }: { row: FxRow }) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const { saveFxRate, saveFxRefreshSource, refreshFxRate } = usePreferences();
  const sourceId = useId();
  const inputId = useId();
  const { currency, entry, rate } = row;
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingSource, setSavingSource] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const busy = saving || refreshing || savingSource;
  const shownText = touched ? text : rate !== null ? formatDecimalInput(rate, locale) : '';
  const isManual = entry?.source === 'MANUAL';
  const refreshSource: FxRefreshSource = entry?.refreshSource ?? 'AWESOMEAPI';

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseDecimalInput(shownText, locale);
    if (parsed === null) {
      const params = { example: moneyErrorParams(locale, undefined).example };
      setError(isAmbiguousDecimal(shownText, locale) ? t('fx.ambiguousInput', params) : t('fx.invalidInput', params));
      setOk(null);
      return;
    }
    setSaving(true);
    setError(null);
    setOk(null);
    saveFxRate(currency, parsed)
      .then(() => {
        setTouched(false);
        setOk(t('settings.fx.saved'));
      })
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, locale)))
      .finally(() => setSaving(false));
  };

  const onRefresh = () => {
    setRefreshing(true);
    setError(null);
    setOk(null);
    refreshFxRate(currency)
      .then((result) => {
        setTouched(false);
        if (!result.quote) return; // o botão manual sempre traz a cotação; só a atualização ao abrir é pulada
        setOk(
          t('settings.fx.refreshed', {
            source: tLoose(`fx.sourceName.${result.quote.source}`),
            rate: formatRate(result.quote.rate, locale, currency),
          }),
        );
      })
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, locale)))
      .finally(() => setRefreshing(false));
  };

  const onChangeSource = (value: string) => {
    if (value !== 'AWESOMEAPI' && value !== 'PTAX') return;
    setSavingSource(true);
    setError(null);
    setOk(null);
    saveFxRefreshSource(value)
      .then(() => setOk(t('settings.fx.refreshSourceSaved')))
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, locale)))
      .finally(() => setSavingSource(false));
  };

  return (
    <div className={styles.fxRow} data-testid={`fx-row-${currency}`} role="group" aria-label={currencyLabel(currency, locale)}>
      <div className={styles.row}>
        <strong>{currencyLabel(currency, locale)}</strong>
        {row.isDisplay && <span className={styles.tag}>{t('settings.fx.displayBadge')}</span>}
      </div>
      <div className={styles.row}>
        <span className={styles.big}>
          {rate !== null ? t('settings.fx.value', { rate: formatRate(rate, locale, currency) }) : t('settings.fx.notSet')}
        </span>
      </div>
      {entry !== null && rate !== null && (
        <p className={styles.muted} data-testid={`fx-description-${currency}`}>
          {describeFxRate(
            { rate, currency, source: entry.source, quotedAt: entry.quotedAt, updatedAt: entry.updatedAt },
            locale,
            tLoose,
          )}
        </p>
      )}
      {/* Cotação antiga (UAH, KZT e CNY costumam vir com a data de dias atrás): destaque discreto, sem alarme. */}
      {row.stale && row.ageDays !== null && (
        <p className={styles.staleNote} data-testid={`fx-stale-${currency}`}>
          {t('settings.fx.staleHint', { age: tPlural('common.dayCount', row.ageDays) })}
        </p>
      )}

      {row.sources.length > 1 && (
        <div className={styles.field}>
          <label htmlFor={sourceId} className={styles.label}>{t('settings.fx.refreshSourceLabel')}</label>
          <select
            id={sourceId}
            className={styles.input}
            value={refreshSource}
            onChange={(e) => onChangeSource(e.target.value)}
            disabled={busy}
          >
            {row.sources.map((source) => (
              <option key={source} value={source}>{t(`settings.fx.refreshSource.${source}`)}</option>
            ))}
          </select>
        </div>
      )}
      {/* D338: com uma fonte automática, a cotação é atualizada sozinha ao abrir o app; a digitada à mão, não. */}
      {isManual && <p className={styles.muted} data-testid={`fx-auto-refresh-hint-${currency}`}>{t('settings.fx.autoRefreshPausedManual')}</p>}

      <form className={styles.form} onSubmit={onSave}>
        <div className={styles.field}>
          <label htmlFor={inputId} className={styles.label}>{t('settings.fx.manualLabel')}</label>
          <input
            id={inputId}
            className={styles.input}
            value={shownText}
            onChange={(e) => {
              setText(e.target.value);
              setTouched(true);
            }}
            inputMode="decimal"
            aria-invalid={error !== null}
            disabled={busy}
          />
        </div>
        <button type="submit" className={styles.button} disabled={busy}>
          {saving ? t('fx.saving') : t('settings.fx.save')}
        </button>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={onRefresh} disabled={busy}>
          {refreshing ? t('settings.fx.refreshing') : t('settings.fx.refresh')}
        </button>
      </form>
      {ok && <p className={styles.ok} role="status">{ok}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}

// Cotações por moeda na tela de configurações (D152, D162, D369): uma linha para cada moeda que precisa de cotação (a de conversão e as
// das lojas), com edição manual, fonte, data e "atualizar cotação".
export default function FxRateSettings() {
  const t = useT();
  const { displayCurrency, fxRates, requiredFxCurrencies } = usePreferences();
  const rows = useMemo(
    // `now` só para marcar a cotação antiga; a tela recalcula quando as configurações mudam ou ela é aberta.
    () => buildFxRows(requiredFxCurrencies, fxRates, displayCurrency, new Date()),
    [requiredFxCurrencies, fxRates, displayCurrency],
  );

  return (
    <section className={styles.card} aria-labelledby="settings-fx-title">
      <h2 id="settings-fx-title" className={styles.cardTitle}>{t('settings.fx.title')}</h2>
      <p className={styles.muted}>{t('settings.fx.intro')}</p>
      {rows.length === 0 && <p className={styles.muted} data-testid="fx-none-needed">{t('settings.fx.noneNeeded')}</p>}
      {rows.map((row) => <FxRateRow key={row.currency} row={row} />)}
      {rows.length > 0 && <p className={styles.muted}>{t('settings.fx.autoRefreshHint')}</p>}
      <p className={styles.muted}>{t('settings.fx.note')}</p>
    </section>
  );
}
