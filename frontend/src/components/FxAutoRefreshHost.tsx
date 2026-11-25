'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatRate } from '@/lib/format';
import { currenciesToAutoRefresh } from '@/lib/fxRates';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { browserOnline, isOfflineFailure, reportStartup } from '@/lib/startupStatus';
import { ApiRequestError, getSettings, refreshFxRate } from '@/services/api';
import styles from './ImportNotice.module.css';

// Espera a tela carregar antes de buscar a cotação em segundo plano. Não é um limite: a busca corre junto com a importação do
// CSFloat e espera o tempo que a conexão precisar (até o limite do backend).
const START_DELAY_MS = 1000;
// Uma tentativa por carga da página; o backend garante uma por moeda por processo (um F5 não repete).
let attemptedThisPage = false;

interface Failure {
  currency: string;
  reason: string;
}

// Atualização das cotações ao abrir o app (D338, D369), montada no layout: no desktop e no start-app.bat. Percorre, em série (o backend
// só aceita uma atualização por vez), todas as moedas que precisam de cotação (a de conversão e as das lojas). Só com a cotação vinda
// de uma fonte automática; a digitada à mão nunca é sobrescrita. Sucesso é silencioso (a tela só passa a mostrar a cotação nova); erro
// vira um aviso curto e o app segue com a última cotação.
export default function FxAutoRefreshHost() {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const settingsQuery = useQuery({ queryKey: queryKeys.settings.all, queryFn: ({ signal }) => getSettings(signal) });
  const settings = settingsQuery.data ?? null;
  const started = useRef(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  useEffect(() => {
    if (started.current || attemptedThisPage || !settings) return undefined;
    const currencies = currenciesToAutoRefresh(settings.requiredFxCurrencies, settings.fxRates);
    if (currencies.length === 0) return undefined;
    const timer = setTimeout(() => {
      if (started.current || attemptedThisPage) return;
      started.current = true;
      attemptedThisPage = true;
      void (async () => {
        let refreshed = false;
        let firstFailure: { currency: string; error: unknown } | null = null;
        for (const currency of currencies) {
          try {
            const result = await refreshFxRate({ currency, trigger: 'AUTO' });
            if (result.quote) refreshed = true;
          } catch (err: unknown) {
            // Sem internet: as demais moedas falhariam do mesmo jeito; o modal único "Sem conexão" avisa (junto com o CSFloat).
            if (isOfflineFailure(err instanceof ApiRequestError ? err.code : null, browserOnline())) {
              reportStartup('fx', 'OFFLINE');
              firstFailure = null;
              break;
            }
            if (firstFailure === null) firstFailure = { currency, error: err };
          }
        }
        if (refreshed) {
          reportStartup('fx', 'OK');
          await invalidate('settings.fx');
        }
        if (firstFailure) setFailure({ currency: firstFailure.currency, reason: errorMessageFor(firstFailure.error, tLoose, locale) });
      })();
    }, START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [settings, invalidate, tLoose, locale]);

  if (!failure) return null;
  const lastRate = settings?.fxRates.find((entry) => entry.currency === failure.currency)?.rate ?? null;
  return (
    <div className={`${styles.notice} ${styles.error} ${styles.left}`} role="status" aria-live="polite">
      <span className={styles.text}>
        {lastRate !== null
          ? t('settings.fx.autoFailedWithRate', { currency: failure.currency, reason: failure.reason, rate: formatRate(lastRate, locale, failure.currency) })
          : t('settings.fx.autoFailed', { currency: failure.currency, reason: failure.reason })}
      </span>
      <button type="button" className={styles.close} onClick={() => setFailure(null)} aria-label={t('common.close')}>×</button>
    </div>
  );
}
