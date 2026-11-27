'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { usePreferences } from '@/components/PreferencesProvider';
import Banner from '@/components/ui/Banner';
import { useLocale, useT } from '@/i18n/I18nProvider';
import { formatDateTime } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { offlineTasks, retryStartupTasks, useStartupStatus } from '@/lib/startupStatus';
import { getCsfloatIntegration, getSettings } from '@/services/api';
import styles from './StartupOfflineBanner.module.css';

// Faixa "Sem conexão com a internet" ao abrir o app (D370, 12.4; antes era um modal): diz o que não foi atualizado (cotação e/ou
// importação do CSFloat), quando foi a última atualização de cada uma, e deixa "Tentar de novo" ou "Dispensar". Some sozinha quando as
// tarefas voltam a dar OK. O app continua com os últimos dados; nada foi gravado.
export default function StartupOfflineBanner() {
  const t = useT();
  const locale = useLocale();
  const status = useStartupStatus();
  const { displayCurrency } = usePreferences();
  const tasks = offlineTasks(status);
  const key = tasks.join(',');
  const [dismissed, setDismissed] = useState<string>('');
  const [retrying, setRetrying] = useState(false);
  const active = tasks.length > 0;

  // Só consulta enquanto a faixa existe (as duas consultas já estão no cache, usadas pelos hosts em toda página).
  const settings = useQuery({ queryKey: queryKeys.settings.all, queryFn: ({ signal }) => getSettings(signal), enabled: active });
  const integration = useQuery({ queryKey: queryKeys.integrations.csfloat, queryFn: ({ signal }) => getCsfloatIntegration(signal), enabled: active });

  // A internet voltou (evento do sistema): refaz uma vez, sem esperar o clique.
  useEffect(() => {
    if (!active) return undefined;
    const onOnline = () => void retryStartupTasks();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [active]);

  if (!active || key === dismissed) return null;

  const retry = () => {
    setRetrying(true);
    retryStartupTasks().finally(() => setRetrying(false));
  };

  // Última cotação da moeda de conversão (a data na fonte, ou a da gravação). Com USD não há cotação, então não há linha.
  const fxEntry = displayCurrency === 'USD' ? null : (settings.data?.fxRates.find((entry) => entry.currency === displayCurrency) ?? null);
  const fxDate = fxEntry && fxEntry.rate !== null ? (fxEntry.quotedAt ?? fxEntry.updatedAt) : null;
  const lastImportAt = integration.data?.lastImportAt ?? null;
  const importText = integration.data
    ? lastImportAt
      ? t('startup.offline.lastImport', { date: formatDateTime(lastImportAt, locale) })
      : t('startup.offline.neverImported')
    : null;

  return (
    <Banner tone="warning" title={t('startup.offline.title')} onRetry={retry} retrying={retrying} onDismiss={() => setDismissed(key)}>
      <div data-testid="startup-offline">
        <p className={styles.p}>{t('startup.offline.intro')}</p>
        <ul className={styles.list}>
          {tasks.map((task) => (
            <li key={task}>
              {t(task === 'fx' ? 'startup.offline.fx' : 'startup.offline.csfloat')}
              {task === 'fx' && fxDate && <span className={styles.last}>{t('startup.offline.lastFx', { date: formatDateTime(fxDate, locale) })}</span>}
              {task === 'csfloat' && importText && <span className={styles.last}>{importText}</span>}
            </li>
          ))}
        </ul>
        <p className={styles.p}>{t('startup.offline.hint')}</p>
      </div>
    </Banner>
  );
}
