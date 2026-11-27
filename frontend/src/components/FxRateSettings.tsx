'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { currencyLabel } from '@/lib/currencies';
import { formatRate } from '@/lib/format';
import { describeFxRate } from '@/lib/fxDisplay';
import { boundsFor, boundsParams, isOutOfBounds } from '@/lib/fxBounds';
import { buildFxRows, type FxRow } from '@/lib/fxRates';
import { formatDecimalInput } from '@/lib/numberInput';
import { queryKeys } from '@/lib/queryKeys';
import { getSettings } from '@/services/api';
import type { FxRefreshSource } from '@/types/api';
import styles from './FxRateSettings.module.css';
import { usePreferences } from './PreferencesProvider';
import Badge from './ui/Badge';
import Banner from './ui/Banner';
import Button from './ui/Button';
import NumberField from './ui/NumberField';
import Panel from './ui/Panel';
import Select from './ui/Select';
import { useToast } from './ui/Toast';

// Uma moeda: valor ("US$ 1 = …"), fonte e data à esquerda; campo da cotação manual e botões à direita (embaixo, em contêiner estreito).
// A PTAX só aparece no BRL (D369 4.4). A faixa aceita é mostrada e avisada ao digitar; o servidor é quem recusa (12.8).
function FxRateRow({ row }: { row: FxRow }) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const toast = useToast();
  const { saveFxRate, saveFxRefreshSource, refreshFxRate } = usePreferences();
  const settings = useQuery({ queryKey: queryKeys.settings.all, queryFn: ({ signal }) => getSettings(signal) });
  const { currency, entry, rate } = row;
  const bounds = boundsFor(settings.data?.fxManualRateBounds, currency);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingSource, setSavingSource] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const busy = saving || refreshing || savingSource;
  const shownText = touched ? text : rate !== null ? formatDecimalInput(rate, locale) : '';
  const isManual = entry?.source === 'MANUAL';
  const refreshSource: FxRefreshSource = entry?.refreshSource ?? 'AWESOMEAPI';
  const outOfBounds = touched && isOutOfBounds(parsed, bounds);

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    const value = touched ? parsed : rate;
    if (value === null) {
      setError(t('fx.invalidInput', { example: '1.25' }));
      return;
    }
    setSaving(true);
    setError(null);
    setRowError(null);
    saveFxRate(currency, value)
      .then(() => {
        setTouched(false);
        toast.show({ tone: 'success', message: t('settings.fx.saved') });
      })
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, locale)))
      .finally(() => setSaving(false));
  };

  const onRefresh = () => {
    setRefreshing(true);
    setError(null);
    setRowError(null);
    refreshFxRate(currency)
      .then((result) => {
        setTouched(false);
        if (!result.quote) return; // o botão manual sempre traz a cotação; só a atualização ao abrir é pulada
        toast.show({
          tone: 'success',
          message: t('settings.fx.refreshed', {
            source: tLoose(`fx.sourceName.${result.quote.source}`),
            rate: formatRate(result.quote.rate, locale, currency),
          }),
        });
      })
      .catch((err: unknown) => setRowError(errorMessageFor(err, tLoose, locale)))
      .finally(() => setRefreshing(false));
  };

  const onChangeSource = (value: string) => {
    if (value !== 'AWESOMEAPI' && value !== 'PTAX') return;
    setSavingSource(true);
    setError(null);
    setRowError(null);
    saveFxRefreshSource(value)
      .then(() => toast.show({ tone: 'success', message: t('settings.fx.refreshSourceSaved') }))
      .catch((err: unknown) => setRowError(errorMessageFor(err, tLoose, locale)))
      .finally(() => setSavingSource(false));
  };

  return (
    <div className={styles.row} data-testid={`fx-row-${currency}`} role="group" aria-label={currencyLabel(currency, locale)}>
      <div className={styles.info}>
        <div className={styles.head}>
          <strong>{currencyLabel(currency, locale)}</strong>
          {row.isDisplay && <Badge tone="info">{t('settings.fx.displayBadge')}</Badge>}
          {/* Cotação antiga (UAH, KZT e CNY costumam vir com a data de dias atrás): destaque discreto, sem alarme. */}
          {row.stale && row.ageDays !== null && (
            <Badge tone="stuck" icon="clock">{tPlural('common.dayCount', row.ageDays)}</Badge>
          )}
        </div>
        <span className={styles.big}>
          {rate !== null ? t('settings.fx.value', { rate: formatRate(rate, locale, currency) }) : t('settings.fx.notSet')}
        </span>
        {entry !== null && rate !== null && (
          <p className={styles.muted} data-testid={`fx-description-${currency}`}>
            {describeFxRate(
              { rate, currency, source: entry.source, quotedAt: entry.quotedAt, updatedAt: entry.updatedAt },
              locale,
              tLoose,
            )}
          </p>
        )}
        {row.stale && row.ageDays !== null && (
          <p className={styles.stale} data-testid={`fx-stale-${currency}`}>
            {t('settings.fx.staleHint', { age: tPlural('common.dayCount', row.ageDays) })}
          </p>
        )}
        {/* D338: com uma fonte automática, a cotação é atualizada sozinha ao abrir o app; a digitada à mão, não. */}
        {isManual && <p className={styles.muted} data-testid={`fx-auto-refresh-hint-${currency}`}>{t('settings.fx.autoRefreshPausedManual')}</p>}
      </div>

      <form className={styles.controls} onSubmit={onSave} noValidate>
        {row.sources.length > 1 && (
          <Select
            label={t('settings.fx.refreshSourceLabel')}
            value={refreshSource}
            onChange={onChangeSource}
            disabled={busy}
            options={row.sources.map((source) => ({ value: source, label: t(`settings.fx.refreshSource.${source}`) }))}
          />
        )}
        <NumberField
          kind="decimal"
          label={t('settings.fx.manualLabel')}
          name={`rate-${currency}`}
          value={shownText}
          disabled={busy}
          error={error}
          hint={
            bounds ? (
              <>
                <span className={styles.line}>{t('settings.fx.boundsHint', boundsParams(bounds, locale))}</span>
                {outOfBounds && <span className={`${styles.line} ${styles.warn}`}>{t('settings.fx.outOfBounds', boundsParams(bounds, locale))}</span>}
              </>
            ) : undefined
          }
          onValueChange={(next, value) => {
            setText(next);
            setParsed(value);
            setTouched(true);
            setError(null);
          }}
        />
        <div className={styles.buttons}>
          <Button variant="primary" icon="refresh" loading={refreshing} disabled={saving || savingSource} onClick={onRefresh}>
            {refreshing ? t('settings.fx.refreshing') : t('settings.fx.refresh')}
          </Button>
          <Button type="submit" loading={saving} disabled={refreshing || savingSource}>
            {saving ? t('fx.saving') : t('settings.fx.save')}
          </Button>
        </div>
        {rowError && <Banner tone="danger" onDismiss={() => setRowError(null)}>{rowError}</Banner>}
      </form>
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
    <Panel title={t('settings.fx.title')} hint={t('settings.fx.intro')}>
      <div className={styles.list}>
        {rows.length === 0 && <p className={styles.muted} data-testid="fx-none-needed">{t('settings.fx.noneNeeded')}</p>}
        {rows.map((row) => <FxRateRow key={row.currency} row={row} />)}
        {rows.length > 0 && <p className={styles.muted}>{t('settings.fx.autoRefreshHint')}</p>}
        <p className={styles.muted}>{t('settings.fx.note')}</p>
      </div>
    </Panel>
  );
}
