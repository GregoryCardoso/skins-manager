'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { autoImportNotice, NOTHING_NEW_DISMISS_MS, shouldRunAutoImport, type AutoImportNotice } from '@/lib/autoImport';
import { browserOnline, isOfflineFailure, reportStartup } from '@/lib/startupStatus';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, getCsfloatIntegration, runCsfloatImport } from '@/services/api';
import type { ImportBatchView, IntegrationView } from '@/types/api';
import ImportSummaryModal from './ImportSummaryModal';
import UndoImportDialog from './UndoImportDialog';
import styles from './ImportNotice.module.css';

// Espera a tela carregar antes de importar em segundo plano (não disputa a primeira renderização). Não é um limite: a importação
// corre junto com a busca da cotação e espera o tempo que a conexão precisar (até o limite do backend).
const START_DELAY_MS = 1000;
// Uma tentativa por carga da página; o backend garante uma por processo (um F5 não repete).
let attemptedThisPage = false;

// Importação ao abrir o app (9.5, D303), montada no layout: no desktop e no start-app.bat. Nada trava: o pedido corre em segundo
// plano e só aparece um aviso discreto se entrou algo novo (com o resumo e o desfazer) ou se deu erro.
export default function CsfloatAutoImportHost() {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const language = useLanguage();
  const invalidate = useInvalidate();
  const queryClient = useQueryClient();
  const integrationQuery = useQuery({
    queryKey: queryKeys.integrations.csfloat,
    queryFn: ({ signal }) => getCsfloatIntegration(signal),
    refetchInterval: (query) => (query.state.data?.importInProgress ? 2000 : false),
  });
  const integration = integrationQuery.data ?? null;
  const started = useRef(false);
  const [batch, setBatch] = useState<ImportBatchView | null>(null);
  const [notice, setNotice] = useState<AutoImportNotice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [showUndo, setShowUndo] = useState(false);

  useEffect(() => {
    if (started.current || attemptedThisPage || !shouldRunAutoImport(integration)) return undefined;
    const timer = setTimeout(() => {
      if (started.current || attemptedThisPage) return;
      started.current = true;
      attemptedThisPage = true;
      // O botão manual fica "Importando…" na hora (o backend recusaria com IMPORT_IN_PROGRESS de qualquer forma).
      queryClient.setQueryData<IntegrationView>(queryKeys.integrations.csfloat, (current) => (current ? { ...current, importInProgress: true } : current));
      runCsfloatImport({ trigger: 'AUTO' })
        .then((result) => {
          // Pulada (já rodou, pausada, ocupada): sem aviso. Rodou sem nada novo: o aviso curto "nada novo".
          if (!result.skipped) {
            reportStartup('csfloat', 'OK');
            setBatch(result.batch);
            setNotice(autoImportNotice(result.batch));
          }
          return result.batch ? invalidate('import.run') : invalidate('integration.update');
        })
        .catch((err: unknown) => {
          // Sem internet: o modal único "Sem conexão" avisa (junto com a cotação); outros erros, o aviso discreto.
          if (isOfflineFailure(err instanceof ApiRequestError ? err.code : null, browserOnline())) reportStartup('csfloat', 'OFFLINE');
          else setError(errorMessageFor(err, tLoose, language));
          invalidate('integration.update').catch(() => undefined);
        });
    }, START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [integration, invalidate, queryClient, tLoose, language]);

  const dismiss = () => {
    setNotice(null);
    setError(null);
  };

  // "Nada novo" é só informativo: some sozinho.
  useEffect(() => {
    if (notice?.kind !== 'NOTHING_NEW') return undefined;
    const timer = setTimeout(() => setNotice(null), NOTHING_NEW_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!notice && !error && !showSummary && !showUndo) return null;
  return (
    <>
      {(notice || error) && (
        <div className={error ? `${styles.notice} ${styles.error}` : styles.notice} role="status" aria-live="polite">
          <span className={styles.text}>
            {error
              ? t('imports.auto.failed', { reason: error })
              : notice?.kind === 'CREATED'
                ? tPlural('imports.auto.created', notice.count)
                : notice?.kind === 'TRANSFERS'
                  ? tPlural('imports.auto.transfers', notice.count)
                  : notice?.kind === 'MATCHED'
                    ? tPlural('imports.auto.matched', notice.count)
                    : notice?.kind === 'NOTHING_NEW'
                      ? t('imports.auto.nothingNew')
                      : t('imports.auto.attention')}
          </span>
          {!error && batch && (
            <span className={styles.links}>
              <button type="button" className={styles.link} onClick={() => setShowSummary(true)}>{t('imports.auto.seeSummary')}</button>
              {batch.undoable && (
                <button type="button" className={styles.link} onClick={() => setShowUndo(true)}>{t('imports.undo.button')}</button>
              )}
              <Link href="/imports/" className={styles.link} onClick={dismiss}>{t('imports.summary.details')}</Link>
            </span>
          )}
          <button type="button" className={styles.close} onClick={dismiss} aria-label={t('common.close')}>×</button>
        </div>
      )}
      {showSummary && batch && <ImportSummaryModal batch={batch} onClose={() => setShowSummary(false)} />}
      {showUndo && batch && (
        <UndoImportDialog
          batchId={batch.id}
          onClose={() => setShowUndo(false)}
          onFinished={() => {
            setShowUndo(false);
            dismiss();
          }}
        />
      )}
    </>
  );
}
