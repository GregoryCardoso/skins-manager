'use client';

import { useQuery } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { validateApiKeyInput } from '@/lib/apiKeyInput';
import { applyFeeUpdate, buildFeeUpdateBody, buildFeeWarnings } from '@/lib/feeCheck';
import { queryKeys } from '@/lib/queryKeys';
import { isHttpsLink } from '@/lib/safeUrl';
import { useInvalidate } from '@/lib/useInvalidate';
import {
  getCsfloatIntegration, removeCsfloatApiKey, saveCsfloatApiKey, switchCsfloatAccount, testCsfloatConnection, updateStore,
} from '@/services/api';
import type { CsfloatTestResult } from '@/types/api';
import ConfirmDialog from './ConfirmDialog';
import cardStyles from './CsfloatIntegrationCard.module.css';
import styles from './settings.module.css';

type Dialog = 'remove' | 'switch' | 'updateStore' | null;

// Card "CSFloat" (9.1, D316): chave da API (nunca volta completa), loja, teste de conexão, aviso de taxa e troca de conta.
export default function CsfloatIntegrationCard() {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const invalidate = useInvalidate();
  const keyId = useId();

  const integrationQuery = useQuery({ queryKey: queryKeys.integrations.csfloat, queryFn: ({ signal }) => getCsfloatIntegration(signal) });
  const integration = integrationQuery.data ?? null;

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
