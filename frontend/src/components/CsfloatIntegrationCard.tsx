'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useId, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDateTime } from '@/lib/format';
import { validateApiKeyInput } from '@/lib/apiKeyInput';
import { pausedReason } from '@/lib/autoImport';
import { applyFeeUpdate, buildFeeUpdateBody, buildFeeWarnings } from '@/lib/feeCheck';
import { queryKeys } from '@/lib/queryKeys';
import { isHttpsLink } from '@/lib/safeUrl';
import { useInvalidate } from '@/lib/useInvalidate';
import {
  getCsfloatIntegration, removeCsfloatApiKey, saveCsfloatApiKey, switchCsfloatAccount, testCsfloatConnection, updateCsfloatIntegration, updateStore,
} from '@/services/api';
import type { CsfloatTestResult } from '@/types/api';
import ConfirmDialog from './ConfirmDialog';
import { useCsfloatImport } from './useCsfloatImport';
import cardStyles from './CsfloatIntegrationCard.module.css';
import styles from './settings.module.css';

type Dialog = 'remove' | 'switch' | 'updateStore' | null;

// Card "CSFloat" (9.1, D316): chave da API (nunca volta completa), loja, teste de conexão, aviso de taxa e troca de conta.
export default function CsfloatIntegrationCard() {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const language = useLanguage();
  const invalidate = useInvalidate();
  const keyId = useId();

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
  const [keyError, setKeyError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<CsfloatTestResult | null>(null);

  const working = busy || testing;

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
    setKeyError(null);
    setOk(null);
  };

  const onSaveKey = (event: FormEvent) => {
    event.preventDefault();
    clearMessages();
    const validation = validateApiKeyInput(keyText);
    if (!validation.ok) {
      setKeyError(t(validation.reason === 'EMPTY' ? 'settings.integrations.csfloat.keyRequired' : 'errors.INVALID_API_KEY_FORMAT'));
      return;
    }
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
  const warnings = buildFeeWarnings(testResult?.feeCheck ?? null, storeName, language, tLoose);

  return (
    <section className={styles.card} aria-labelledby="settings-csfloat-title">
      <h3 id="settings-csfloat-title" className={styles.cardTitle}>{t('settings.integrations.csfloat.title')}</h3>

      {integrationQuery.error !== null && (
        <p className={styles.error} role="alert">{errorMessageFor(integrationQuery.error, tLoose, language)}</p>
      )}
      {integration === null && integrationQuery.error === null && <p className={styles.muted}>{t('common.loading')}</p>}

      {integration && (
        <>
          <p className={cardStyles.savedKey} data-testid="csfloat-key-status">
            {integration.hasApiKey && integration.apiKeyMasked
              ? t('settings.integrations.csfloat.savedKey', { masked: integration.apiKeyMasked })
              : t('settings.integrations.csfloat.noKey')}
          </p>

          <form className={cardStyles.keyRow} onSubmit={onSaveKey}>
            <div className={cardStyles.keyField}>
              <label htmlFor={keyId} className={styles.label}>{t('settings.integrations.csfloat.apiKeyLabel')}</label>
              <input
                id={keyId}
                className={`${styles.input} ${cardStyles.keyInput}`}
                type={showKey ? 'text' : 'password'}
                value={keyText}
                onChange={(e) => setKeyText(e.target.value)}
                placeholder={t('settings.integrations.csfloat.apiKeyPlaceholder')}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-invalid={keyError !== null}
                disabled={working}
              />
            </div>
            <button type="button" className={styles.button} onClick={() => setShowKey((v) => !v)} disabled={working} aria-pressed={showKey}>
              {showKey ? t('settings.integrations.csfloat.hide') : t('settings.integrations.csfloat.show')}
            </button>
            <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={working}>
              {busy ? t('common.saving') : integration.hasApiKey ? t('settings.integrations.csfloat.replaceKey') : t('settings.integrations.csfloat.save')}
            </button>
          </form>
          {keyError !== null && <p className={styles.error} role="alert">{keyError}</p>}

          {integration.storeName ? (
            <p className={styles.muted} data-testid="csfloat-linked-store">
              {t('settings.integrations.csfloat.linkedStore', { store: integration.storeName })}
            </p>
          ) : (
            <p className={styles.warning} role="status" data-testid="csfloat-no-store">
              {t('settings.integrations.csfloat.noStore')}
            </p>
          )}

          <div className={cardStyles.actions}>
            <button type="button" className={styles.button} onClick={onTest} disabled={working || !integration.hasApiKey}>
              {testing ? t('settings.integrations.csfloat.testing') : t('settings.integrations.csfloat.test')}
            </button>
            {integration.hasApiKey && (
              <button type="button" className={styles.button} onClick={() => setDialog('remove')} disabled={working}>
                {t('settings.integrations.csfloat.remove')}
              </button>
            )}
          </div>

          <div className={cardStyles.importBox} data-testid="csfloat-import-box">
            <p className={styles.muted} data-testid="csfloat-last-import">
              {integration.lastImportAt
                ? t('settings.integrations.csfloat.lastImport', { date: formatDateTime(integration.lastImportAt, language) })
                : t('settings.integrations.csfloat.neverImported')}
            </p>
            {integration.lastImportStatus === 'FAILED' && (
              <p className={styles.warning} role="status" data-testid="csfloat-last-import-failed">
                {t('settings.integrations.csfloat.lastImportFailed', { reason: failedReason(integration.lastImportErrorCode) })}
              </p>
            )}
            <label className={cardStyles.toggle}>
              <input
                type="checkbox"
                checked={integration.autoImportOnOpen}
                disabled={working}
                onChange={(event) => patchIntegration({ autoImportOnOpen: event.target.checked })}
                data-testid="csfloat-auto-import"
              />
              {t('settings.integrations.csfloat.autoImport')}
            </label>
            <p className={styles.muted}>
              {integration.tradesCutoffAt
                ? t('settings.integrations.csfloat.autoImportHint')
                : t('settings.integrations.csfloat.autoImportNeedsFirst')}
            </p>
            {(() => {
              const reason = pausedReason(integration);
              if (!reason) return null;
              return (
                <div className={styles.warning} role="status" data-testid="csfloat-auto-paused">
                  <p>
                    {reason.kind === 'UNDO'
                      ? t('settings.integrations.csfloat.autoPausedUndo', { date: formatDateTime(reason.at, language) })
                      : t('settings.integrations.csfloat.autoPausedSwitch')}
                  </p>
                  <button type="button" className={styles.button} onClick={() => patchIntegration({ autoImportPaused: false })} disabled={working}>
                    {t('settings.integrations.csfloat.autoResume')}
                  </button>
                </div>
              );
            })()}
            {integration.tradesCutoffAt && (
              <p className={styles.muted}>
                {t('settings.integrations.csfloat.cutoffInfo', { date: formatDateTime(integration.tradesCutoffAt, language) })}{' '}
                <Link href="/imports/#cutoff">{t('imports.cutoffChange.link')}</Link>
              </p>
            )}
            {integration.openEntriesCount > 0 && (
              <p className={styles.muted}>
                <Link href="/imports/">{tPlural('settings.integrations.csfloat.openEntries', integration.openEntriesCount)}</Link>
              </p>
            )}
            <div className={cardStyles.actions}>
              <button
                type="button"
                className={`${styles.button} ${styles.primary}`}
                onClick={() => importer.start()}
                disabled={working || importer.disabledReason !== null}
              >
                {importer.running || importer.disabledReason === 'RUNNING' ? t('imports.running') : t('settings.integrations.csfloat.importNow')}
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => importer.start({ fullScan: true })}
                disabled={working || importer.disabledReason !== null}
                title={t('settings.integrations.csfloat.fullScanHint')}
              >
                {t('settings.integrations.csfloat.fullScan')}
              </button>
            </div>
            <p className={styles.muted}>{t('settings.integrations.csfloat.fullScanHint')}</p>
          </div>

          {testResult && (
            <div className={cardStyles.warnings}>
              <p className={styles.ok} role="status">
                {testResult.username
                  ? t('settings.integrations.csfloat.connectedAs', { username: testResult.username })
                  : t('settings.integrations.csfloat.connectedNoName')}
              </p>
              {!testResult.accountMatches && (
                <div className={styles.warning} role="alert">
                  <p>{t('settings.integrations.csfloat.accountMismatch')}</p>
                  <button type="button" className={styles.button} onClick={() => setDialog('switch')} disabled={working}>
                    {t('settings.integrations.csfloat.switchAccount')}
                  </button>
                </div>
              )}
              {warnings.map((warning) => (
                <p key={warning.kind} className={styles.warning} role="status">{warning.text}</p>
              ))}
              {warnings.length > 0 && feeUpdateBody !== null && integration.storeId !== null && (
                <div>
                  <button type="button" className={styles.button} onClick={() => setDialog('updateStore')} disabled={working}>
                    {t('settings.integrations.csfloat.updateStore')}
                  </button>
                </div>
              )}
            </div>
          )}

          {ok !== null && <p className={styles.ok} role="status">{ok}</p>}
          {error !== null && <p className={styles.error} role="alert">{errorMessageFor(error, tLoose, language)}</p>}

          <p className={styles.muted}>{t('settings.integrations.csfloat.privacy')}</p>
          <p className={styles.muted}>
            {isHttpsLink(integration.helpUrl) ? (
              <a className={cardStyles.helpLink} href={integration.helpUrl} target="_blank" rel="noopener noreferrer">
                {t('settings.integrations.csfloat.help')}
              </a>
            ) : (
              t('settings.integrations.csfloat.help')
            )}{' '}
            {t('settings.integrations.csfloat.helpText')}
          </p>
        </>
      )}

      {importer.dialogs}
      {dialog === 'remove' && (
        <ConfirmDialog
          title={t('settings.integrations.csfloat.removeConfirmTitle')}
          message={t('settings.integrations.csfloat.removeConfirmBody')}
          confirmLabel={t('settings.integrations.csfloat.remove')}
          danger
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
    </section>
  );
}
