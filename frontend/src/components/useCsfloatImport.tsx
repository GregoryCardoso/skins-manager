'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState, type ReactNode } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { formatDateTime } from '@/lib/format';
import { changeCutoff, getCsfloatIntegration, runCsfloatImport } from '@/services/api';
import type { CutoffTarget, ImportBatchView, IntegrationView } from '@/types/api';
import forms from './forms.module.css';
import ConfirmDialog from './ConfirmDialog';
import CutoffChangeModal from './CutoffChangeModal';
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
  // Abre a mudança da data de corte (9.5.3) ou a definição/mudança da data dos aportes e saques (9.6), com a pré-visualização e a
  // mesma trava "importando…".
  openCutoffChange: (target?: CutoffTarget) => void;
  // Modais do fluxo (corte, confirmação da varredura, mudança de corte, resumo e erro): o chamador os renderiza uma vez.
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
  const [confirmFullScan, setConfirmFullScan] = useState(false);
  const [changingCutoff, setChangingCutoff] = useState<CutoffTarget | null>(null);
  const [result, setResult] = useState<ImportBatchView | null>(null);
  const [error, setError] = useState<unknown>(null);

  const disabledReason = importDisabledReason(integration, running);

  const execute = useCallback(
    (body: { cutoffAt?: string; fullScan?: boolean; newCutoffAt?: string; target?: CutoffTarget }) => {
      setRunning(true);
      setError(null);
      const { newCutoffAt, target, ...runBody } = body;
      const call = newCutoffAt ? changeCutoff(newCutoffAt, target ?? 'TRADES') : runCsfloatImport(runBody);
      call
        .then(({ batch }) => {
          setCutoffFor(null);
          setConfirmFullScan(false);
          setChangingCutoff(null);
          setResult(batch); // a manual (e a mudança de corte) sempre devolve o lote
          return newCutoffAt ? invalidate('import.changeCutoff') : invalidate('import.run');
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
      // Varredura completa (D324): confirmação antes, explicando que o corte continua valendo.
      if (fullScan) {
        setError(null);
        setConfirmFullScan(true);
        return;
      }
      execute({ fullScan });
    },
    [disabledReason, integration, execute],
  );

  const openCutoffChange = useCallback((target: CutoffTarget = 'TRADES') => {
    if (disabledReason !== null || integration === null || integration.tradesCutoffAt === null) return;
    setError(null);
    setChangingCutoff(target);
  }, [disabledReason, integration]);

  const errorText = error === null ? null : errorMessageFor(error, tLoose, language);
  const inlineError = cutoffFor !== null || confirmFullScan || changingCutoff !== null;

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
      {confirmFullScan && integration?.tradesCutoffAt && (
        <ConfirmDialog
          title={t('imports.fullScanConfirm.title')}
          message={t('imports.fullScanConfirm.body', { date: formatDateTime(integration.tradesCutoffAt, language) })}
          confirmLabel={t('imports.fullScanConfirm.confirm')}
          busy={running}
          error={errorText}
          onConfirm={() => execute({ fullScan: true })}
          onCancel={() => {
            setConfirmFullScan(false);
            setError(null);
          }}
        />
      )}
      {changingCutoff !== null && integration?.tradesCutoffAt && (
        <CutoffChangeModal
          target={changingCutoff}
          currentCutoffAt={changingCutoff === 'TRANSACTIONS' ? integration.transactionsCutoffAt ?? null : integration.tradesCutoffAt}
          busy={running}
          error={errorText}
          onConfirm={(newCutoffAt) => execute({ newCutoffAt, target: changingCutoff })}
          onCancel={() => {
            setChangingCutoff(null);
            setError(null);
          }}
        />
      )}
      {result !== null && <ImportSummaryModal batch={result} onClose={() => setResult(null)} />}
      {error !== null && !inlineError && (
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

  return { integration, running, disabledReason, start, openCutoffChange, dialogs };
}
