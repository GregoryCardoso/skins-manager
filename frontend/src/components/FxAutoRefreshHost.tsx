'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useTLoose } from '@/i18n/I18nProvider';
import { currenciesToAutoRefresh } from '@/lib/fxRates';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { browserOnline, isOfflineFailure, registerStartupRetry, reportStartup } from '@/lib/startupStatus';
import { ApiRequestError, getSettings, refreshFxRate } from '@/services/api';

// Espera a tela carregar antes de buscar a cotação em segundo plano. Não é um limite: a busca corre junto com a importação do
// CSFloat e espera o tempo que a conexão precisar (até o limite do backend).
const START_DELAY_MS = 1000;
// Uma tentativa por carga da página; o backend garante uma por moeda por processo (um F5 não repete).
let attemptedThisPage = false;

// Falha de uma moeda (a primeira) da atualização ao abrir o app; o GlobalNotices a mostra como Banner (12.4).
export interface FxRefreshFailure {
  currency: string;
  reason: string;
}

interface RefreshOutcome {
  refreshed: boolean;
  offline: boolean;
  firstFailure: { currency: string; error: unknown } | null;
}

// Percorre, em série (o backend só aceita uma atualização por vez), as moedas dadas. `AUTO` é o de ao abrir o app; `MANUAL` é o do
// "Tentar de novo" da faixa sem internet (o mesmo gatilho do botão "Atualizar cotação": o AUTO o backend só aceita uma vez por moeda).
async function refreshAll(currencies: readonly string[], trigger: 'AUTO' | 'MANUAL'): Promise<RefreshOutcome> {
  let refreshed = false;
  let offline = false;
  let firstFailure: { currency: string; error: unknown } | null = null;
  for (const currency of currencies) {
    try {
      const result = await refreshFxRate({ currency, trigger });
      if (result.quote) refreshed = true;
    } catch (err: unknown) {
      // Sem internet: as demais moedas falhariam do mesmo jeito; a faixa única "Sem conexão" avisa (junto com o CSFloat).
      if (isOfflineFailure(err instanceof ApiRequestError ? err.code : null, browserOnline())) {
        reportStartup('fx', 'OFFLINE');
        offline = true;
        firstFailure = null;
        break;
      }
      if (firstFailure === null) firstFailure = { currency, error: err };
    }
  }
  return { refreshed, offline, firstFailure };
}

// Atualização das cotações ao abrir o app (D338, D369), montada no GlobalNotices: no desktop e no start-app.bat. Percorre todas as
// moedas que precisam de cotação (a de conversão e as das lojas). Só com a cotação vinda de uma fonte automática; a digitada à mão
// nunca é sobrescrita. Sucesso é silencioso (a tela só passa a mostrar a cotação nova); erro vira um Banner curto (por `onFailure`)
// e o app segue com a última cotação. Não renderiza nada.
export default function FxAutoRefreshHost({ onFailure }: { onFailure?: (failure: FxRefreshFailure | null) => void }) {
  const tLoose = useTLoose();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const settingsQuery = useQuery({ queryKey: queryKeys.settings.all, queryFn: ({ signal }) => getSettings(signal) });
  const settings = settingsQuery.data ?? null;
  const started = useRef(false);
  const onFailureRef = useRef(onFailure);
  onFailureRef.current = onFailure;
  // As moedas de agora (a retentativa usa as de quando clicar, não as de quando o host montou).
  const currenciesRef = useRef<string[]>([]);
  currenciesRef.current = settings ? currenciesToAutoRefresh(settings.requiredFxCurrencies, settings.fxRates) : [];

  useEffect(() => {
    if (started.current || attemptedThisPage || !settings) return undefined;
    const currencies = currenciesToAutoRefresh(settings.requiredFxCurrencies, settings.fxRates);
    if (currencies.length === 0) return undefined;
    const timer = setTimeout(() => {
      if (started.current || attemptedThisPage) return;
      started.current = true;
      attemptedThisPage = true;
      void (async () => {
        const { refreshed, firstFailure } = await refreshAll(currencies, 'AUTO');
        if (refreshed) {
          reportStartup('fx', 'OK');
          await invalidate('settings.fx');
        }
        if (firstFailure) onFailureRef.current?.({ currency: firstFailure.currency, reason: errorMessageFor(firstFailure.error, tLoose, locale) });
      })();
    }, START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [settings, invalidate, tLoose, locale]);

  // "Tentar de novo" da faixa sem internet: refaz a mesma busca com o gatilho manual e informa o resultado.
  useEffect(() => {
    return registerStartupRetry('fx', async () => {
      const { offline, firstFailure } = await refreshAll(currenciesRef.current, 'MANUAL');
      if (offline) return;
      // A fonte voltou a responder: a faixa some. Outro erro (fonte fora do ar, por exemplo) aparece como aviso de falha.
      reportStartup('fx', 'OK');
      await invalidate('settings.fx');
      if (firstFailure) onFailureRef.current?.({ currency: firstFailure.currency, reason: errorMessageFor(firstFailure.error, tLoose, locale) });
    });
  }, [invalidate, tLoose, locale]);

  return null;
}
