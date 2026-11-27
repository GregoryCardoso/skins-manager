'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { apiKeyFormatDetail, validateApiKeyInput } from '@/lib/apiKeyInput';
import { pausedReason } from '@/lib/autoImport';
import { applyFeeUpdate, buildFeeUpdateBody, buildFeeWarnings } from '@/lib/feeCheck';
import { formatDateTime } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import {
  getCsfloatIntegration, removeCsfloatApiKey, saveCsfloatApiKey, switchCsfloatAccount, testCsfloatConnection, updateCsfloatIntegration, updateStore,
} from '@/services/api';
import type { CsfloatTestResult } from '@/types/api';
import cardStyles from './CsfloatIntegrationCard.module.css';
import CsfloatSetupGuide from './CsfloatSetupGuide';
import Badge from './ui/Badge';
import Banner from './ui/Banner';
import Button from './ui/Button';
import ConfirmDialog from './ui/ConfirmDialog';
import Disclosure from './ui/Disclosure';
import IconButton from './ui/IconButton';
import Menu, { type MenuEntry } from './ui/Menu';
import Panel from './ui/Panel';
import Skeleton from './ui/Skeleton';
import Switch from './ui/Switch';
import TextField from './ui/TextField';
import { useCsfloatImport } from './useCsfloatImport';

type Dialog = 'remove' | 'switch' | 'updateStore' | null;

// Card "CSFloat" (9.1, D316; 12.9): guia em passos, chave da API (nunca volta completa) com validação ao colar e ao digitar,
// loja, teste de conexão, aviso de taxa, troca de conta e "Importar ao abrir" como Switch. A varredura completa, a data de corte,
// remover a chave e trocar de conta ficam em "Mais opções".
export default function CsfloatIntegrationCard() {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const invalidate = useInvalidate();

  const integrationQuery = useQuery({ queryKey: queryKeys.integrations.csfloat, queryFn: ({ signal }) => getCsfloatIntegration(signal) });
  const integration = integrationQuery.data ?? null;
  // Importação (9.2): o mesmo fluxo do botão do Inventário e de Vendas (corte na primeira vez, resumo e erro).
  const importer = useCsfloatImport();

  // A chave digitada vive só neste estado (nunca no cache de consultas) e é limpa depois de salvar.
  const [keyText, setKeyText] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<CsfloatTestResult | null>(null);

  const working = busy || testing;
  const validation = validateApiKeyInput(keyText);
  const detail = apiKeyFormatDetail(keyText);
  const keyLength = validation.ok ? validation.value.length : 0;
  const keyError = detail === 'SHORT' ? t('settings.integrations.csfloat.keyTooShort')
    : detail === 'LONG' ? t('settings.integrations.csfloat.keyTooLong')
      : detail === 'SPACES' ? t('settings.integrations.csfloat.keyHasSpaces')
        : null;

  // "Importar ao abrir o app" (9.5, começa desligada) e "Reativar" depois de uma pausa.
  const patchIntegration = (body: { autoImportOnOpen?: boolean; autoImportPaused?: false }) => {
    clearMessages();
    setBusy(true);
    updateCsfloatIntegration(body)
      .then(() => invalidate('integration.update'))
      .catch((err: unknown) => setError(err))
      .finally(() => setBusy(false));
  };
  const clearMessages = () => {
    setError(null);
    setOk(null);
  };

  const onSaveKey = (event: FormEvent) => {
    event.preventDefault();
    clearMessages();
    if (!validation.ok) return;
    setBusy(true);
    saveCsfloatApiKey(validation.value)
      .then(() => {
        setKeyText('');
        setShowKey(false);
        setTestResult(null);
        setOk(t('settings.integrations.csfloat.keySaved'));
        return invalidate('integration.apiKey');
      })
      .catch((err: unknown) => setError(err))
      .finally(() => setBusy(false));
  };

  const onRemoveKey = () => {
    clearMessages();
    setBusy(true);
    removeCsfloatApiKey()
      .then(() => {
        setDialog(null);
        setTestResult(null);
        setOk(t('settings.integrations.csfloat.keyRemoved'));
        return invalidate('integration.apiKey');
      })
      .catch((err: unknown) => {
        setDialog(null);
        setError(err);
      })
      .finally(() => setBusy(false));
  };

  const onTest = () => {
    clearMessages();
    setTestResult(null);
    setTesting(true);
    testCsfloatConnection()
      .then((result) => {
        setTestResult(result);
        return invalidate('integration.test');
      })
      .catch((err: unknown) => setError(err))
      .finally(() => setTesting(false));
  };

  const onSwitchAccount = () => {
    clearMessages();
    setBusy(true);
    switchCsfloatAccount()
      .then((result) => {
        setDialog(null);
        setTestResult(null);
        setOk(
          result.username
            ? t('settings.integrations.csfloat.switched', { username: result.username })
            : t('settings.integrations.csfloat.switchedNoName'),
        );
        return invalidate('integration.switchAccount');
      })
      .catch((err: unknown) => {
        setDialog(null);
        setError(err);
      })
      .finally(() => setBusy(false));
  };

  const feeUpdateBody = buildFeeUpdateBody(testResult?.feeCheck ?? null);
  const onUpdateStore = () => {
    if (!integration || integration.storeId === null || !feeUpdateBody || !testResult) return;
    clearMessages();
    setBusy(true);
    updateStore(integration.storeId, feeUpdateBody)
      .then(() => {
        setDialog(null);
        setTestResult((current) => (current ? { ...current, feeCheck: applyFeeUpdate(current.feeCheck) } : current));
        setOk(t('settings.integrations.csfloat.storeUpdated'));
        return invalidate('store.update');
      })
      .catch((err: unknown) => {
        setDialog(null);
        setError(err);
      })
      .finally(() => setBusy(false));
  };

  // Motivo da última falha de importação, traduzido pelo código (cai no próprio código se faltar a tradução).
  const failedReason = (code: string | null): string => {
    if (!code) return t('errors.UNKNOWN');
    const key = `errors.${code}`;
    const text = tLoose(key);
    return text !== key ? text : code;
  };

  const storeName = integration?.storeName ?? '';
  const warnings = buildFeeWarnings(testResult?.feeCheck ?? null, storeName, locale, tLoose);
  const paused = integration ? pausedReason(integration) : null;

  // "Mais opções": varredura completa, data de corte (leva à página Importações), remover a chave e, só quando a conta não
  // confere, trocar de conta.
  const moreItems: MenuEntry[] = integration
    ? [
        {
          id: 'full-scan',
          label: t('settings.integrations.csfloat.fullScan'),
          icon: 'refresh',
          disabled: working || importer.disabledReason !== null,
          onSelect: () => importer.start({ fullScan: true }),
        },
        ...(integration.tradesCutoffAt
          ? [{ id: 'cutoff', label: t('imports.cutoffChange.open'), icon: 'clock' as const, href: '/imports/#cutoff' }]
          : []),
        ...(testResult && !testResult.accountMatches
          ? [{ id: 'switch', label: t('settings.integrations.csfloat.switchAccount'), icon: 'refresh' as const, disabled: working, onSelect: () => setDialog('switch') }]
          : []),
        ...(integration.hasApiKey
          ? [
              { type: 'separator' as const },
              { id: 'remove', label: t('settings.integrations.csfloat.remove'), tone: 'danger' as const, disabled: working, onSelect: () => setDialog('remove') },
            ]
          : []),
      ]
    : [];

  return (
    <div id="csfloat">
      <Panel
        title={t('settings.integrations.csfloat.title')}
        headingLevel={3}
        actions={integration ? <Menu label={t('imports.moreOptions')} trigger={<Button icon="more">{t('imports.moreOptions')}</Button>} items={moreItems} /> : undefined}
      >
        <div className={cardStyles.stack}>
          {integrationQuery.error !== null && (
            <Banner tone="danger" onRetry={() => void integrationQuery.refetch()} retrying={integrationQuery.isFetching}>
              {errorMessageFor(integrationQuery.error, tLoose, locale)}
            </Banner>
          )}
          {integration === null && integrationQuery.error === null && <Skeleton height="6rem" radius="md" />}

          {integration && (
            <>
              {integration.hasApiKey ? (
                <Disclosure label={t('settings.integrations.csfloat.help')}>
                  <CsfloatSetupGuide />
                </Disclosure>
              ) : (
                <CsfloatSetupGuide />
              )}

              <p className={cardStyles.savedKey} data-testid="csfloat-key-status">
                {integration.hasApiKey && integration.apiKeyMasked
                  ? t('settings.integrations.csfloat.savedKey', { masked: integration.apiKeyMasked })
                  : t('settings.integrations.csfloat.noKey')}
              </p>

              <form className={cardStyles.keyRow} onSubmit={onSaveKey} noValidate>
                <TextField
                  label={t('settings.integrations.csfloat.apiKeyLabel')}
                  name="apiKey"
                  type={showKey ? 'text' : 'password'}
                  value={keyText}
                  onChange={setKeyText}
                  placeholder={t('settings.integrations.csfloat.apiKeyPlaceholder')}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  error={keyError}
                  hint={validation.ok ? <Badge tone="profit" icon="check">{tPlural('settings.integrations.csfloat.keyValid', keyLength)}</Badge> : undefined}
                  disabled={working}
                  className={cardStyles.keyField}
                  trailing={(
                    <IconButton
                      icon={showKey ? 'eyeOff' : 'eye'}
                      label={showKey ? t('settings.integrations.csfloat.hide') : t('settings.integrations.csfloat.show')}
                      pressed={showKey}
                      size="sm"
                      disabled={working}
                      onClick={() => setShowKey((v) => !v)}
                    />
                  )}
                />
                <Button type="submit" variant="primary" loading={busy} disabled={working || !validation.ok}>
                  {busy ? t('common.saving') : integration.hasApiKey ? t('settings.integrations.csfloat.replaceKey') : t('settings.integrations.csfloat.save')}
                </Button>
              </form>

              {integration.storeName ? (
                <p className={cardStyles.muted} data-testid="csfloat-linked-store">
                  {t('settings.integrations.csfloat.linkedStore', { store: integration.storeName })}
                </p>
              ) : (
                <Banner tone="warning">
                  <span data-testid="csfloat-no-store">{t('settings.integrations.csfloat.noStore')}</span>
                </Banner>
              )}

              <div className={cardStyles.actions}>
                <Button onClick={onTest} loading={testing} disabled={working || !integration.hasApiKey}>
                  {testing ? t('settings.integrations.csfloat.testing') : t('settings.integrations.csfloat.test')}
                </Button>
                <Button variant="primary" onClick={() => importer.start()} disabled={working || importer.disabledReason !== null}>
                  {importer.running || importer.disabledReason === 'RUNNING' ? t('imports.running') : t('settings.integrations.csfloat.importNow')}
                </Button>
              </div>

              {testResult && (
                <div className={cardStyles.stack}>
                  <Banner tone={testResult.accountMatches ? 'success' : 'warning'}>
                    {testResult.username
                      ? t('settings.integrations.csfloat.connectedAs', { username: testResult.username })
                      : t('settings.integrations.csfloat.connectedNoName')}
                  </Banner>
                  {!testResult.accountMatches && (
                    <Banner tone="warning" action={{ label: t('settings.integrations.csfloat.switchAccount'), onClick: () => setDialog('switch') }}>
                      {t('settings.integrations.csfloat.accountMismatch')}
                    </Banner>
                  )}
                  {warnings.map((warning, index) => (
                    <Banner
                      key={warning.kind}
                      tone="warning"
                      action={index === warnings.length - 1 && feeUpdateBody !== null && integration.storeId !== null
                        ? { label: t('settings.integrations.csfloat.updateStore'), onClick: () => setDialog('updateStore') }
                        : undefined}
                    >
                      {warning.text}
                    </Banner>
                  ))}
                </div>
              )}

              <div className={cardStyles.importBox} data-testid="csfloat-import-box">
                <p className={cardStyles.muted} data-testid="csfloat-last-import">
                  {integration.lastImportAt
                    ? t('settings.integrations.csfloat.lastImport', { date: formatDateTime(integration.lastImportAt, locale) })
                    : t('settings.integrations.csfloat.neverImported')}
                </p>
                {integration.lastImportStatus === 'FAILED' && (
                  <Banner tone="warning">
                    <span data-testid="csfloat-last-import-failed">
                      {t('settings.integrations.csfloat.lastImportFailed', { reason: failedReason(integration.lastImportErrorCode) })}
                    </span>
                  </Banner>
                )}
                <Switch
                  label={t('settings.integrations.csfloat.autoImport')}
                  checked={integration.autoImportOnOpen}
                  disabled={working}
                  onChange={(checked) => patchIntegration({ autoImportOnOpen: checked })}
                  hint={integration.tradesCutoffAt ? t('settings.integrations.csfloat.autoImportHint') : t('settings.integrations.csfloat.autoImportNeedsFirst')}
                />
                {paused && (
                  <Banner
                    tone="warning"
                    action={{ label: t('settings.integrations.csfloat.autoResume'), onClick: () => patchIntegration({ autoImportPaused: false }) }}
                  >
                    <span data-testid="csfloat-auto-paused">
                      {paused.kind === 'UNDO'
                        ? t('settings.integrations.csfloat.autoPausedUndo', { date: formatDateTime(paused.at, locale) })
                        : t('settings.integrations.csfloat.autoPausedSwitch')}
                    </span>
                  </Banner>
                )}
                {integration.tradesCutoffAt && (
                  <div className={cardStyles.cutoffRow}>
                    <p className={cardStyles.muted}>
                      {t('settings.integrations.csfloat.cutoffInfo', { date: formatDateTime(integration.tradesCutoffAt, locale) })}
                    </p>
                    <Link prefetch={false} href="/imports/" className={cardStyles.link} data-testid="csfloat-review-imports">
                      {t('settings.integrations.csfloat.reviewImports')}
                    </Link>
                  </div>
                )}
                {integration.openEntriesCount > 0 && (
                  <p className={cardStyles.muted}>
                    <Link prefetch={false} href="/imports/">{tPlural('settings.integrations.csfloat.openEntries', integration.openEntriesCount)}</Link>
                  </p>
                )}
              </div>

              {ok !== null && <Banner tone="success">{ok}</Banner>}
              {error !== null && <Banner tone="danger">{errorMessageFor(error, tLoose, locale)}</Banner>}

              <p className={cardStyles.muted}>{t('settings.integrations.csfloat.privacy')}</p>
            </>
          )}
        </div>
      </Panel>

      {importer.dialogs}
      {dialog === 'remove' && (
        <ConfirmDialog
          title={t('settings.integrations.csfloat.removeConfirmTitle')}
          message={t('settings.integrations.csfloat.removeConfirmBody')}
          confirmLabel={t('settings.integrations.csfloat.remove')}
          tone="danger"
          busy={busy}
          onConfirm={onRemoveKey}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'switch' && (
        <ConfirmDialog
          title={t('settings.integrations.csfloat.switchConfirmTitle')}
          message={t('settings.integrations.csfloat.switchConfirmBody')}
          confirmLabel={t('settings.integrations.csfloat.switchAccount')}
          busy={busy}
          onConfirm={onSwitchAccount}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'updateStore' && (
        <ConfirmDialog
          title={t('settings.integrations.csfloat.updateStore')}
          message={t('settings.integrations.csfloat.updateStoreConfirm', { store: storeName })}
          confirmLabel={t('settings.integrations.csfloat.updateStore')}
          busy={busy}
          onConfirm={onUpdateStore}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
