'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState, type ReactNode } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { getCsfloatIntegration, runCsfloatImport } from '@/services/api';
import type { ImportBatchView, IntegrationView } from '@/types/api';
import forms from './forms.module.css';
import ImportCutoffModal from './ImportCutoffModal';
import ImportSummaryModal from './ImportSummaryModal';
import Modal from './Modal';

export type ImportDisabledReason = 'LOADING' | 'NO_KEY' | 'NO_STORE' | 'RUNNING';

// Por que o botão de importar está desabilitado (ou null se pode importar). Função pura.
export function importDisabledReason(integration: IntegrationView | null, running: boolean): ImportDisabledReason | null {
  if (integration === null) return 'LOADING';
  if (running || integration.importInProgress) return 'RUNNING';
  if (!integration.hasApiKey) return 'NO_KEY';
  if (integration.storeId === null) return 'NO_STORE';
  return null;
}

export interface CsfloatImportControls {
  integration: IntegrationView | null;
  running: boolean;
  disabledReason: ImportDisabledReason | null;
  // Começa a importação: na primeira vez abre o modal do corte; senão importa direto.
  start: (options?: { fullScan?: boolean }) => void;
  // Modais do fluxo (corte, resumo e erro): o chamador os renderiza uma vez.
  dialogs: ReactNode;
}

// Fluxo da importação do CSFloat, compartilhado pelo botão do Inventário/Vendas e pelo card das configurações (9.2, D318).
export function useCsfloatImport(): CsfloatImportControls {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const invalidate = useInvalidate();

  // Enquanto o backend importa (outra aba, por exemplo), consulta de novo até terminar (D303).
  const integrationQuery = useQuery({
    queryKey: queryKeys.integrations.csfloat,
    queryFn: ({ signal }) => getCsfloatIntegration(signal),
    refetchInterval: (query) => (query.state.data?.importInProgress ? 2000 : false),
  });
  const integration = integrationQuery.data ?? null;

  const [running, setRunning] = useState(false);
  const [cutoffFor, setCutoffFor] = useState<{ fullScan: boolean } | null>(null);
  const [result, setResult] = useState<ImportBatchView | null>(null);
  const [error, setError] = useState<unknown>(null);

  const disabledReason = importDisabledReason(integration, running);

  const execute = useCallback(
    (body: { cutoffAt?: string; fullScan?: boolean }) => {
      setRunning(true);
      setError(null);
      runCsfloatImport(body)
        .then(({ batch }) => {
          setCutoffFor(null);
          setResult(batch);
          return invalidate('import.run');
        })
        .catch((err: unknown) => {
          setError(err);
          // Mesmo com erro, o backend pode ter gravado um lote FAILED e o estado da integração.
          invalidate('import.run').catch(() => undefined);
        })
        .finally(() => setRunning(false));
    },
    [invalidate],
  );

  const start = useCallback(
    (options: { fullScan?: boolean } = {}) => {
      if (disabledReason !== null || integration === null) return;
      const fullScan = options.fullScan === true;
      if (integration.tradesCutoffAt === null) {
        setError(null);
        setCutoffFor({ fullScan });
        return;
      }
      execute({ fullScan });
    },
    [disabledReason, integration, execute],
  );

  const errorText = error === null ? null : errorMessageFor(error, tLoose, language);

  const dialogs = (
    <>
      {cutoffFor !== null && (
        <ImportCutoffModal
          suggestedCutoffAt={integration?.suggestedCutoffAt ?? null}
          busy={running}
          error={errorText}
          onConfirm={(cutoffAt) => execute({ cutoffAt, fullScan: cutoffFor.fullScan })}
          onCancel={() => {
            setCutoffFor(null);
            setError(null);
          }}
        />
      )}
      {result !== null && <ImportSummaryModal batch={result} onClose={() => setResult(null)} />}
      {error !== null && cutoffFor === null && (
        <Modal title={t('imports.errorTitle')} onClose={() => setError(null)}>
          <div className={forms.form}>
            <div className={forms.topError} role="alert">{errorText}</div>
            <div className={forms.actions}>
              <button type="button" className={`${forms.button} ${forms.primary}`} onClick={() => setError(null)} autoFocus>
                {t('common.close')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );

  return { integration, running, disabledReason, start, dialogs };
}
