'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { reportAutoImport } from '@/lib/autoImportProgress';
import { autoImportNotice, NOTHING_NEW_DISMISS_MS, shouldRunAutoImport, type AutoImportNotice } from '@/lib/autoImport';
import { browserOnline, isOfflineFailure, registerStartupRetry, reportStartup } from '@/lib/startupStatus';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, getCsfloatIntegration, runCsfloatImport } from '@/services/api';
import type { ImportBatchView, IntegrationView } from '@/types/api';
import ImportSummaryModal from './ImportSummaryModal';
import { useToast } from './ui/Toast';

// Espera a tela carregar antes de importar em segundo plano (não disputa a primeira renderização). Não é um limite: a importação
// corre junto com a busca da cotação e espera o tempo que a conexão precisar (até o limite do backend).
const START_DELAY_MS = 1000;
// Uma tentativa por carga da página; o backend garante uma por processo (um F5 não repete).
let attemptedThisPage = false;

// Importação ao abrir o app (9.5, D303), montada no layout: no desktop e no start-app.bat. Nada trava: o pedido corre em segundo
// plano e só aparece um aviso (Toast) se entrou algo novo (com o resumo, onde estão o desfazer e o "Ver detalhes") ou se deu erro.
export default function CsfloatAutoImportHost() {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const integrationQuery = useQuery({
    queryKey: queryKeys.integrations.csfloat,
    queryFn: ({ signal }) => getCsfloatIntegration(signal),
    refetchInterval: (query) => (query.state.data?.importInProgress ? 2000 : false),
  });
  const integration = integrationQuery.data ?? null;
  const started = useRef(false);
  const [batch, setBatch] = useState<ImportBatchView | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  // O texto do aviso do lote automático (ou do "Tentar de novo"): a mensagem e, havendo lote, a ação que abre o resumo.
  const noticeText = useCallback(
    (notice: AutoImportNotice): string =>
      notice.kind === 'CREATED'
        ? tPlural('imports.auto.created', notice.count)
        : notice.kind === 'TRANSFERS'
          ? tPlural('imports.auto.transfers', notice.count)
          : notice.kind === 'MATCHED'
            ? tPlural('imports.auto.matched', notice.count)
            : notice.kind === 'NOTHING_NEW'
              ? t('imports.auto.nothingNew')
              : t('imports.auto.attention'),
    [t, tPlural],
  );
  const showNotice = useCallback(
    (notice: AutoImportNotice, result: ImportBatchView | null) => {
      setBatch(result);
      toast.show({
        tone: 'info',
        message: noticeText(notice),
        // "Nada novo" é só informativo: some sozinho. Com lote, o resumo abre o modal (desfazer e "Ver detalhes" estão nele).
        durationMs: notice.kind === 'NOTHING_NEW' ? NOTHING_NEW_DISMISS_MS : undefined,
        action: result ? { label: t('imports.auto.seeSummary'), onClick: () => setShowSummary(true) } : undefined,
      });
    },
    [toast, noticeText, t],
  );

  useEffect(() => {
    if (started.current || attemptedThisPage || !shouldRunAutoImport(integration)) return undefined;
    const timer = setTimeout(() => {
      if (started.current || attemptedThisPage) return;
      started.current = true;
      attemptedThisPage = true;
      // O botão manual fica "Importando…" na hora (o backend recusaria com IMPORT_IN_PROGRESS de qualquer forma).
      queryClient.setQueryData<IntegrationView>(queryKeys.integrations.csfloat, (current) => (current ? { ...current, importInProgress: true } : current));
      reportAutoImport('RUNNING');
      runCsfloatImport({ trigger: 'AUTO' })
        .then((result) => {
          reportAutoImport('DONE');
          // Pulada (já rodou, pausada, ocupada): sem aviso. Rodou sem nada novo: o aviso curto "nada novo".
          if (!result.skipped) {
            reportStartup('csfloat', 'OK');
            showNotice(autoImportNotice(result.batch), result.batch);
          }
          return result.batch ? invalidate('import.run') : invalidate('integration.update');
        })
        .catch((err: unknown) => {
          reportAutoImport('DONE');
          // Sem internet: a faixa única "Sem conexão" avisa (junto com a cotação); outros erros, um aviso de erro (Toast).
          if (isOfflineFailure(err instanceof ApiRequestError ? err.code : null, browserOnline())) reportStartup('csfloat', 'OFFLINE');
          else toast.show({ tone: 'danger', message: t('imports.auto.failed', { reason: errorMessageFor(err, tLoose, locale) }) });
          invalidate('integration.update').catch(() => undefined);
        });
    }, START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [integration, invalidate, queryClient, tLoose, locale, showNotice, toast, t]);

  // "Tentar de novo" da faixa sem internet: refaz a importação com o gatilho manual (o mesmo do botão "Importar agora"; o automático
  // o backend só aceita uma vez por abertura). Sem o CSFloat pronto (chave, loja ou data de corte), não há o que refazer.
  const integrationRef = useRef(integration);
  integrationRef.current = integration;
  useEffect(() => {
    return registerStartupRetry('csfloat', async () => {
      const current = integrationRef.current;
      if (!current || !current.hasApiKey || current.storeId === null || current.tradesCutoffAt === null || current.importInProgress) return;
      try {
        const result = await runCsfloatImport({ trigger: 'MANUAL' });
        reportStartup('csfloat', 'OK');
        showNotice(autoImportNotice(result.batch), result.batch);
        await invalidate('import.run');
      } catch (err: unknown) {
        if (isOfflineFailure(err instanceof ApiRequestError ? err.code : null, browserOnline())) reportStartup('csfloat', 'OFFLINE');
        else {
          // A internet voltou, mas a importação falhou por outro motivo: a faixa some e o erro aparece à parte.
          reportStartup('csfloat', 'OK');
          toast.show({ tone: 'danger', message: t('imports.auto.failed', { reason: errorMessageFor(err, tLoose, locale) }) });
        }
        await invalidate('integration.update').catch(() => undefined);
      }
    });
  }, [invalidate, showNotice, toast, t, tLoose, locale]);

  if (!showSummary || !batch) return null;
  return <ImportSummaryModal batch={batch} onClose={() => setShowSummary(false)} />;
}
