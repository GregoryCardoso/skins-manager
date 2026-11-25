'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useId, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDateTime, formatFloat, formatMoney } from '@/lib/format';
import { buildLaunchBody, initialLaunchState, setLaunchAcquiredAt, type LaunchErrors, type LaunchFormState } from '@/lib/pendingActions';
import { addDaysToLocalInput } from '@/lib/dateInput';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, getCsfloatIntegration, listStores, resolveImportEntry } from '@/services/api';
import type { ImportEntryView } from '@/types/api';
import forms from './forms.module.css';
import Modal from './Modal';

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

// "Lançar compra" de uma "venda sem compra no app" (9.5.1b, D327): a identidade do item vem da pendência (travada); o usuário
// informa loja, preço, cotação, data e fim do trade lock. Ao salvar, o backend cria a compra e registra a venda na hora.
export default function LaunchPurchaseModal({ entry, onClose, onDone }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const ids = { store: useId(), price: useId(), fx: useId(), acquired: useId(), unlock: useId() };
  const storesQuery = useQuery({ queryKey: queryKeys.stores.all, queryFn: ({ signal }) => listStores(signal) });
  const integrationQuery = useQuery({ queryKey: queryKeys.integrations.csfloat, queryFn: ({ signal }) => getCsfloatIntegration(signal) });
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
          const params = (err.params ?? {}) as Record<string, unknown>;
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
  const fieldError = (field: keyof LaunchErrors) =>
    errors[field] ? t(errors[field] as 'imports.launch.dateInvalid') : problem?.kind === 'TEXT' && problem.field === field ? problem.text : null;

  return (
    <Modal title={t('imports.launch.title')} onClose={onClose} busy={busy}>
      <form className={forms.form} onSubmit={submit} noValidate>
        <div>
          <p><strong>{display.name ?? display.marketHashName}</strong></p>
          {details.length > 0 && <p className={forms.hint}>{details.join(' · ')}</p>}
          <p className={forms.hint}>
            {t('imports.launch.saleInfo', {
              price: display.priceCents !== null ? formatMoney(display.priceCents, display.currency, locale) : '',
              date: saleAt ? formatDateTime(saleAt, locale) : '',
            })}
          </p>
          <p className={forms.hint}>{t('imports.launch.identityLocked')}</p>
        </div>
        {!form ? <p>{t('common.loading')}</p> : (
          <>
            <label className={forms.field} htmlFor={ids.store}>
              <span>{t('imports.launch.store')}</span>
              <select className={forms.input} id={ids.store} value={form.storeId ?? ''} onChange={(e) => update({ storeId: e.target.value ? Number(e.target.value) : null })} disabled={busy}>
                {stores.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.currency})</option>)}
              </select>
              {fieldError('store') && <span className={forms.error}>{fieldError('store')}</span>}
            </label>
            <label className={forms.field} htmlFor={ids.price}>
              <span>{t('imports.launch.price', { currency: store?.currency ?? '' })}</span>
              <input className={forms.input} id={ids.price} inputMode="decimal" value={form.price} onChange={(e) => update({ price: e.target.value })} disabled={busy} autoFocus />
              {fieldError('price') && <span className={forms.error}>{fieldError('price')}</span>}
            </label>
            {store?.currency === 'BRL' && (
              <label className={forms.field} htmlFor={ids.fx}>
                <span>{t('imports.launch.fxRate')}</span>
                <input className={forms.input} id={ids.fx} inputMode="decimal" value={form.fxRate} onChange={(e) => update({ fxRate: e.target.value })} disabled={busy} />
                {fieldError('fxRate') && <span className={forms.error}>{fieldError('fxRate')}</span>}
              </label>
            )}
            <label className={forms.field} htmlFor={ids.acquired}>
              <span>{t('imports.launch.acquiredAt')}</span>
              <input className={forms.input} id={ids.acquired} type="datetime-local" value={form.acquiredAt} onChange={(e) => setState(setLaunchAcquiredAt(form, e.target.value))} disabled={busy} />
              <span className={forms.hint}>{t('imports.launch.acquiredHint')}</span>
              {fieldError('acquiredAt') && <span className={forms.error}>{fieldError('acquiredAt')}</span>}
            </label>
            <label className={forms.field} htmlFor={ids.unlock}>
              <span>{t('imports.launch.tradeUnlockAt')}</span>
              <input
                id={ids.unlock}
                type="datetime-local"
                value={form.tradeUnlockAt}
                onChange={(e) => update({ tradeUnlockAt: e.target.value, unlockEdited: true })}
                disabled={busy}
              />
              <span className={forms.hint}>
                {t('imports.launch.unlockHint', { date: saleAt ? formatDateTime(saleAt, locale) : '' })}
                {' '}
                <button
                  type="button"
                  className={forms.linkButton}
                  disabled={busy || form.acquiredAt === ''}
                  onClick={() => update({ tradeUnlockAt: addDaysToLocalInput(form.acquiredAt, 7), unlockEdited: true })}
                >
                  {t('imports.launch.plusSeven')}
                </button>
              </span>
              {fieldError('tradeUnlockAt') && <span className={forms.error}>{fieldError('tradeUnlockAt')}</span>}
            </label>
          </>
        )}

        {problem?.kind === 'TEXT' && !problem.field && <div className={forms.topError} role="alert">{problem.text}</div>}
        {problem?.kind === 'WARNING' && (
          <div className={forms.topError} role="alert">
            <p>{t('imports.launch.warnBeforeCutoff', { date: problem.cutoffAt ? formatDateTime(problem.cutoffAt, locale) : '' })}</p>
            <button type="button" className={forms.button} disabled={busy} onClick={() => send({ confirmWarnings: true })}>
              {t('imports.launch.confirmAnyway')}
            </button>
          </div>
        )}
        {problem?.kind === 'NO_CREDIT' && (
          <div className={forms.topError} role="alert">
            <p>{t('imports.launch.noCredit')}</p>
            <button type="button" className={forms.button} disabled={busy} onClick={() => send({ confirmWarnings: true, purchaseOnly: true })}>
              {t('imports.launch.purchaseOnly')}
            </button>
          </div>
        )}
        {problem?.kind === 'UNIT_IN_STOCK' && (
          <div className={forms.topError} role="alert">
            <p>{t('imports.launch.unitInStock')}</p>
            {problem.itemIds.map((itemId) => (
              <Link key={itemId} href={`/?item=${itemId}`} onClick={onClose}>{t('imports.seeCandidate', { id: itemId })}</Link>
            ))}
          </div>
        )}

        <div className={forms.actions}>
          <button type="button" className={forms.button} onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className={`${forms.button} ${forms.primary}`} disabled={busy || !form}>
            {busy ? t('common.saving') : t('imports.launch.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
