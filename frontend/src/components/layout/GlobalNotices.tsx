'use client';

import { useState } from 'react';
import FxAutoRefreshHost, { type FxRefreshFailure } from '@/components/FxAutoRefreshHost';
import { usePreferences } from '@/components/PreferencesProvider';
import Banner from '@/components/ui/Banner';
import { useLocale, useT } from '@/i18n/I18nProvider';
import { formatRate } from '@/lib/format';
import { buildFxRows } from '@/lib/fxRates';
import StartupOfflineBanner from './StartupOfflineBanner';
import styles from './GlobalNotices.module.css';

// Avisos globais no topo do conteúdo, como Banner, empilhados em ordem de prioridade e um por assunto (D370, 12.4):
// 1. sem internet ao abrir o app; 2. falha da atualização automática da cotação; 3. moeda de conversão sem cotação.
// "Loja sem taxa de venda" não é global (vale por loja e por item) e fica no contexto de cada tela.
export default function GlobalNotices() {
  const t = useT();
  const locale = useLocale();
  const { displayCurrency, fxRates, requiredFxCurrencies } = usePreferences();
  const [fxFailure, setFxFailure] = useState<FxRefreshFailure | null>(null);

  // Só presença do dado (nenhuma regra nova): a moeda de conversão ainda não tem cotação gravada. Com USD não há "≈".
  const displayRow = displayCurrency === 'USD' ? null : buildFxRows(requiredFxCurrencies, fxRates, displayCurrency, new Date()).find((row) => row.isDisplay);
  const noDisplayRate = displayRow !== null && displayRow !== undefined && displayRow.rate === null;
  const failureSameCurrency = fxFailure !== null && fxFailure.currency === displayCurrency;

  const lastRate = fxFailure ? (fxRates.find((entry) => entry.currency === fxFailure.currency)?.rate ?? null) : null;

  return (
    <>
      <FxAutoRefreshHost onFailure={setFxFailure} />
      <section className={styles.region} aria-label={t('notices.region')}>
        <StartupOfflineBanner />
        {fxFailure && (
          <Banner tone="warning" action={{ label: t('notices.goToSettings'), href: '/settings/' }} onDismiss={() => setFxFailure(null)}>
            {lastRate !== null
              ? t('settings.fx.autoFailedWithRate', { currency: fxFailure.currency, reason: fxFailure.reason, rate: formatRate(lastRate, locale, fxFailure.currency) })
              : t('settings.fx.autoFailed', { currency: fxFailure.currency, reason: fxFailure.reason })}
          </Banner>
        )}
        {noDisplayRate && !failureSameCurrency && (
          <Banner tone="info" action={{ label: t('notices.goToSettings'), href: '/settings/' }}>
            {t('notices.noDisplayRate', { currency: displayCurrency })}
          </Banner>
        )}
      </section>
    </>
  );
}
