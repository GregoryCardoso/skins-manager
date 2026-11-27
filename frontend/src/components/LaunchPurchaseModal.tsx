'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { moneyErrorParams } from '@/lib/currencies';
import { addDaysToLocalInput } from '@/lib/dateInput';
import { formatDateTime, formatFloat, formatMoney } from '@/lib/format';
import { boundsFor, boundsParams, isOutOfBounds } from '@/lib/fxBounds';
import { localizedOrName } from '@/lib/itemName';
import { parseDecimalInput } from '@/lib/numberInput';
import { buildLaunchBody, initialLaunchState, setLaunchAcquiredAt, type LaunchErrors, type LaunchFormState } from '@/lib/pendingActions';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, getCsfloatIntegration, getSettings, listStores, resolveImportEntry } from '@/services/api';
import type { ImportEntryView } from '@/types/api';
import styles from './imports/importModals.module.css';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import FormErrorSummary, { type FormErrorItem } from './ui/FormErrorSummary';
import NumberField from './ui/NumberField';
import Select from './ui/Select';
import TextField from './ui/TextField';

interface Props {
  entry: ImportEntryView;
  onClose: () => void;
  // `CREATED` = compra lançada e venda registrada; `PURCHASE_ONLY` = só a compra (a pendência continua).
  onDone: (result: 'CREATED' | 'PURCHASE_ONLY') => void;
}

type Problem =
  | { kind: 'WARNING'; cutoffAt: string }
  | { kind: 'NO_CREDIT' }
  | { kind: 'UNIT_IN_STOCK'; itemIds: number[] }
  | { kind: 'TEXT'; text: string; field?: keyof LaunchErrors };

const FORM_ID = 'launch-purchase-form';

// "Lançar compra" de uma "venda sem compra no app" (9.5.1b, D327; 12.9): a identidade do item vem da pendência (travada); o usuário
// informa loja, preço, cotação, data e fim do trade lock. Ao salvar, o backend cria a compra e registra a venda na hora. Os problemas
// que o backend devolve viram avisos com a saída certa (confirmar mesmo assim, salvar só a compra, ver a unidade em estoque).
export default function LaunchPurchaseModal({ entry, onClose, onDone }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const storesQuery = useQuery({ queryKey: queryKeys.stores.all, queryFn: ({ signal }) => listStores(signal) });
  const integrationQuery = useQuery({ queryKey: queryKeys.integrations.csfloat, queryFn: ({ signal }) => getCsfloatIntegration(signal) });
  const settingsQuery = useQuery({ queryKey: queryKeys.settings.all, queryFn: ({ signal }) => getSettings(signal) });
  const stores = storesQuery.data ?? [];
  const [state, setState] = useState<LaunchFormState | null>(null);
  const [errors, setErrors] = useState<LaunchErrors>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);

  const form = state ?? (storesQuery.data ? initialLaunchState(stores, integrationQuery.data?.storeId ?? null) : null);
  const store = form ? stores.find((s) => s.id === form.storeId) ?? null : null;
  const { display } = entry;
  const saleAt = display.date;
  const update = (patch: Partial<LaunchFormState>) => form && setState({ ...form, ...patch });
  const bounds = store && store.currency !== 'USD' ? boundsFor(settingsQuery.data?.fxManualRateBounds, store.currency) : null;
  const fxOutOfBounds = form ? isOutOfBounds(parseDecimalInput(form.fxRate, locale), bounds) : false;

  const send = (options: { confirmWarnings?: boolean; purchaseOnly?: boolean } = {}) => {
    if (!form) return;
    const built = buildLaunchBody(form, stores, locale);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setProblem(null);
    setBusy(true);
    resolveImportEntry(entry.id, { action: 'CREATE_PURCHASE', purchase: built.purchase, ...options })
      .then(() => invalidate('import.resolve'))
      .then(() => onDone(options.purchaseOnly ? 'PURCHASE_ONLY' : 'CREATED'))
      .catch((err: unknown) => {
        if (err instanceof ApiRequestError) {
          const params = (err.details ?? err.params ?? {}) as Record<string, unknown>;
          if (err.code === 'IMPORT_ENTRY_WARNINGS_NOT_CONFIRMED') {
            const warning = (params.warnings as { cutoffAt?: string }[] | undefined)?.[0];
            setProblem({ kind: 'WARNING', cutoffAt: warning?.cutoffAt ?? '' });
            return;
          }
          if (err.code === 'IMPORT_ENTRY_CONFLICT' && params.reason === 'SALE_TX_NOT_FOUND') {
            setProblem({ kind: 'NO_CREDIT' });
            return;
          }
          if (err.code === 'IMPORT_ENTRY_CONFLICT' && params.reason === 'UNIT_IN_STOCK') {
            setProblem({ kind: 'UNIT_IN_STOCK', itemIds: (params.itemIds as number[] | undefined) ?? [] });
            return;
          }
          if (err.code === 'PURCHASE_AFTER_SALE' || err.code === 'PURCHASE_UNLOCK_AFTER_SALE') {
            const date = typeof params.soldAt === 'string' ? formatDateTime(params.soldAt, locale) : '';
            const key = err.code === 'PURCHASE_AFTER_SALE' ? 'imports.launch.afterSale' : 'imports.launch.unlockAfterSale';
            setProblem({ kind: 'TEXT', text: t(key, { date }), field: err.code === 'PURCHASE_AFTER_SALE' ? 'acquiredAt' : 'tradeUnlockAt' });
            return;
          }
        }
        setProblem({ kind: 'TEXT', text: errorMessageFor(err, tLoose, locale) });
      })
      .finally(() => setBusy(false));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  const details: string[] = [];
  if (display.variant && display.variant !== 'NORMAL') details.push(tLoose(`enums.variant.${display.variant}`));
  if (display.floatValue !== null) details.push(`float ${formatFloat(display.floatValue, locale)}`);
  if (display.paintSeed !== null) details.push(`seed ${display.paintSeed}`);
  if (display.phase) details.push(display.phase);

  const fieldError = (field: keyof LaunchErrors): string | null =>
    errors[field]
      ? tLoose(errors[field] as string, moneyErrorParams(locale, field === 'price' ? store?.currency : undefined))
      : problem?.kind === 'TEXT' && problem.field === field
        ? problem.text
        : null;

  const labels: Record<keyof LaunchErrors, string> = {
    store: t('imports.launch.store'),
    price: t('imports.launch.price', { currency: store?.currency ?? '' }),
    fxRate: store ? t('imports.launch.fxRate', { currency: store.currency }) : '',
    acquiredAt: t('imports.launch.acquiredAt'),
    tradeUnlockAt: t('imports.launch.tradeUnlockAt'),
  };
  const summary: FormErrorItem[] = (Object.keys(labels) as (keyof LaunchErrors)[])
    .filter((field) => fieldError(field) !== null)
    .map((field) => ({ field, label: labels[field], message: fieldError(field) as string }));

  return (
    <Dialog
      title={t('imports.launch.title')}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={busy} disabled={!form}>
            {busy ? t('common.saving') : t('imports.launch.submit')}
          </Button>
        </>
      )}
    >
      <form id={FORM_ID} className={styles.form} onSubmit={submit} noValidate>
        <FormErrorSummary errors={summary} />
        <div className={styles.identity}>
          <p className={styles.identityName}>{display.name ? localizedOrName(display.name, display.localizedName) : display.marketHashName}</p>
          {details.length > 0 && <p className={styles.muted}>{details.join(' · ')}</p>}
          <p className={styles.muted}>
            {t('imports.launch.saleInfo', {
              price: display.priceCents !== null ? formatMoney(display.priceCents, display.currency, locale) : '',
              date: saleAt ? formatDateTime(saleAt, locale) : '',
            })}
          </p>
          <p className={styles.muted}>{t('imports.launch.identityLocked')}</p>
        </div>
        {!form ? <p>{t('common.loading')}</p> : (
          <>
            <Select
              label={t('imports.launch.store')}
              name="store"
              value={form.storeId === null ? '' : String(form.storeId)}
              onChange={(value) => update({ storeId: value ? Number(value) : null })}
              options={stores.filter((s) => s.isActive).map((s) => ({ value: String(s.id), label: `${s.name} (${s.currency})` }))}
              error={fieldError('store')}
              disabled={busy}
              required
              full
            />
            <NumberField
              kind="money"
              currency={store?.currency}
              label={t('imports.launch.price', { currency: store?.currency ?? '' })}
              name="price"
              value={form.price}
              onValueChange={(text) => update({ price: text })}
              error={fieldError('price')}
              disabled={busy}
              required
              full
            />
            {store && store.currency !== 'USD' && (
              <NumberField
                kind="decimal"
                label={t('imports.launch.fxRate', { currency: store.currency })}
                name="fxRate"
                value={form.fxRate}
                onValueChange={(text) => update({ fxRate: text })}
                error={fieldError('fxRate')}
                hint={bounds ? (
                  <>
                    <span>{t('settings.fx.boundsHint', boundsParams(bounds, locale))}</span>
                    {fxOutOfBounds && <span> {t('settings.fx.outOfBounds', boundsParams(bounds, locale))}</span>}
                  </>
                ) : undefined}
                disabled={busy}
                optional
                full
              />
            )}
            <TextField
              label={t('imports.launch.acquiredAt')}
              name="acquiredAt"
              type="datetime-local"
              value={form.acquiredAt}
              onChange={(value) => setState(setLaunchAcquiredAt(form, value))}
              hint={t('imports.launch.acquiredHint')}
              error={fieldError('acquiredAt')}
              disabled={busy}
              required
              full
            />
            <div className={styles.stack}>
              <TextField
                label={t('imports.launch.tradeUnlockAt')}
                name="tradeUnlockAt"
                type="datetime-local"
                value={form.tradeUnlockAt}
                onChange={(value) => update({ tradeUnlockAt: value, unlockEdited: true })}
                hint={t('imports.launch.unlockHint', { date: saleAt ? formatDateTime(saleAt, locale) : '' })}
                error={fieldError('tradeUnlockAt')}
                disabled={busy}
                optional
                full
              />
              <div>
                <Button
                  size="sm"
                  disabled={busy || form.acquiredAt === ''}
                  onClick={() => update({ tradeUnlockAt: addDaysToLocalInput(form.acquiredAt, 7), unlockEdited: true })}
                >
                  {t('imports.launch.plusSeven')}
                </Button>
              </div>
            </div>
          </>
        )}

        {problem?.kind === 'TEXT' && !problem.field && <Banner tone="danger">{problem.text}</Banner>}
        {problem?.kind === 'WARNING' && (
          <Banner tone="warning">
            <p>{t('imports.launch.warnBeforeCutoff', { date: problem.cutoffAt ? formatDateTime(problem.cutoffAt, locale) : '' })}</p>
            <div className={styles.inlineAction}>
              <Button size="sm" disabled={busy} onClick={() => send({ confirmWarnings: true })}>{t('imports.launch.confirmAnyway')}</Button>
            </div>
          </Banner>
        )}
        {problem?.kind === 'NO_CREDIT' && (
          <Banner tone="warning">
            <p>{t('imports.launch.noCredit')}</p>
            <div className={styles.inlineAction}>
              <Button size="sm" disabled={busy} onClick={() => send({ confirmWarnings: true, purchaseOnly: true })}>{t('imports.launch.purchaseOnly')}</Button>
            </div>
          </Banner>
        )}
        {problem?.kind === 'UNIT_IN_STOCK' && (
          <Banner tone="warning">
            <p>{t('imports.launch.unitInStock')}</p>
            <div className={styles.links}>
              {problem.itemIds.map((itemId) => (
                <Link key={itemId} href={`/?item=${itemId}`} onClick={onClose}>{t('imports.seeCandidate', { id: itemId })}</Link>
              ))}
            </div>
          </Banner>
        )}
      </form>
    </Dialog>
  );
}
