'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatRate } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { browserOnline, isOfflineFailure, reportStartup } from '@/lib/startupStatus';
import { ApiRequestError, getSettings, refreshFxRate } from '@/services/api';
import styles from './ImportNotice.module.css';

// Espera a tela carregar antes de buscar a cotação em segundo plano. Não é um limite: a busca corre junto com a importação do
// CSFloat e espera o tempo que a conexão precisar (até o limite do backend).
const START_DELAY_MS = 1000;
// Uma tentativa por carga da página; o backend garante uma por processo (um F5 não repete).
let attemptedThisPage = false;

// Atualização da cotação USD→BRL ao abrir o app (D338), montada no layout: no desktop e no start-app.bat. Só com a cotação vinda
// de uma fonte automática (tempo real ou PTAX); a digitada à mão nunca é sobrescrita. Sucesso é silencioso (a tela só passa a
// mostrar a cotação nova); erro vira um aviso curto e o app segue com a última cotação.
export default function FxAutoRefreshHost() {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const invalidate = useInvalidate();
  const settingsQuery = useQuery({ queryKey: queryKeys.settings.all, queryFn: ({ signal }) => getSettings(signal) });
  const settings = settingsQuery.data ?? null;
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current || attemptedThisPage || !settings || settings.usdBrlRateSource === 'MANUAL') return undefined;
    const timer = setTimeout(() => {
      if (started.current || attemptedThisPage) return;
      started.current = true;
      attemptedThisPage = true;
      refreshFxRate({ trigger: 'AUTO' })
        .then((result) => {
          if (!result.quote) return undefined;
          reportStartup('fx', 'OK');
          return invalidate('settings.fx');
        })
        .catch((err: unknown) => {
          // Sem internet: o modal único "Sem conexão" avisa (junto com o CSFloat); outros erros, o aviso discreto.
          if (isOfflineFailure(err instanceof ApiRequestError ? err.code : null, browserOnline())) reportStartup('fx', 'OFFLINE');
          else setError(errorMessageFor(err, tLoose, language));
        });
    }, START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [settings, invalidate, tLoose, language]);

  if (!error) return null;
  return (
    <div className={`${styles.notice} ${styles.error} ${styles.left}`} role="status" aria-live="polite">
      <span className={styles.text}>
        {settings && settings.usdBrlRate !== null
          ? t('settings.fx.autoFailedWithRate', { reason: error, rate: formatRate(settings.usdBrlRate, language) })
          : t('settings.fx.autoFailed', { reason: error })}
      </span>
      <button type="button" className={styles.close} onClick={() => setError(null)} aria-label={t('common.close')}>×</button>
    </div>
  );
}
