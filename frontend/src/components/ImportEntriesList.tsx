'use client';

import Link from 'next/link';
import { useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDate, formatFloat, formatMoney } from '@/lib/format';
import { entryActions, entryLink, entryLinkLabelKey, groupEntries, reasonKey, removeConfirmKey } from '@/lib/importSummary';
import { bulkActionsOf, commonBulkActions, type BulkEntryAction } from '@/lib/pendingActions';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, bulkResolveImportEntries, reopenImportEntry, resolveImportEntry } from '@/services/api';
import type { Category, ImportEntryAction, ImportEntryView } from '@/types/api';
import ConfirmDialog from './ConfirmDialog';
import ItemImage from './ItemImage';
import LaunchPurchaseModal from './LaunchPurchaseModal';
import MarkWonDialog from './MarkWonDialog';
import forms from './forms.module.css';
import styles from './ImportEntriesList.module.css';

interface Props {
  entries: readonly ImportEntryView[];
  // Chamado ao seguir um link para o inventário (fecha o modal que contém a lista).
  onNavigate?: () => void;
  // Título dos grupos: na lista de ignoradas (9.5.1b), um grupo só.
  ignoredList?: boolean;
}

// Mensagem do erro ao resolver: o conflito traz o motivo (ex.: ITEM_SOLD_IN_APP) com texto próprio.
function useResolveErrorText() {
  const tLoose = useTLoose();
  const language = useLanguage();
  return (error: unknown): string => {
    if (error instanceof ApiRequestError && (error.code === 'IMPORT_ENTRY_CONFLICT' || error.code === 'IMPORT_ENTRY_NOT_REOPENABLE')) {
      const reason = (error.params as Record<string, unknown> | undefined)?.reason;
      const key = `imports.actions.conflict.${String(reason)}`;
      const text = tLoose(key);
      if (reason && text !== key) return text;
    }
    return errorMessageFor(error, tLoose, language);
  };
}

// Botões de uma pendência (9.4, D301; 9.5.1b, D327 a D329). "Remover lançamento" pede confirmação; "Lançar compra" e "Foi drop"
// abrem os seus diálogos. Depois de resolvida, mostra o resultado (a lista do resumo é estática; a da página recarrega sozinha).
function EntryActions({ entry, resolvedAs, onResolved }: { entry: ImportEntryView; resolvedAs: string | null; onResolved: (r: string) => void }) {
  const t = useT();
  const tLoose = useTLoose();
  const invalidate = useInvalidate();
  const errorText = useResolveErrorText();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'REMOVE' | 'LAUNCH' | 'WON' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actions = entryActions(entry);
  if (resolvedAs) return <span className={styles.resolved} role="status">{tLoose(`imports.actions.resolved.${resolvedAs}`)}</span>;
  if (actions.length === 0) return null;

  const done = (resolution: string) => {
    setDialog(null);
    onResolved(resolution);
    return invalidate('import.resolve');
  };
  const act = (action: ImportEntryAction, extra: { targetId?: number; acquiredAt?: string } = {}) => {
    setBusy(true);
    setError(null);
    const call = action === 'REOPEN'
      ? reopenImportEntry(entry.id).then(() => 'REOPENED')
      : resolveImportEntry(entry.id, { action, ...extra }).then((updated) => updated.resolution ?? action);
    call
      .then((resolution) => done(resolution))
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };

  const label = (action: ImportEntryAction) => tLoose(`imports.actions.${action}`);
  const onClick = (action: ImportEntryAction) => {
    if (action === 'REMOVE') setDialog('REMOVE');
    else if (action === 'CREATE_PURCHASE') setDialog('LAUNCH');
    else if (action === 'MARK_WON') setDialog('WON');
    else act(action);
  };
  return (
    <>
      <span className={styles.actions}>
        {actions.map((action) => {
          if (action === 'LINK') {
            return entry.candidateIds.map((id) => (
              <button key={`link-${id}`} type="button" className={forms.button} disabled={busy} onClick={() => act('LINK', { targetId: id })}>
                {t('imports.actions.linkTo', { id })}
              </button>
            ));
          }
          const primary = action === 'CREATE_PURCHASE';
          const danger = action === 'REMOVE';
          return (
            <button
              key={action}
              type="button"
              className={danger ? `${forms.button} ${forms.danger}` : primary ? `${forms.button} ${forms.primary}` : forms.button}
              disabled={busy}
              onClick={() => onClick(action)}
            >
              {label(action)}
            </button>
          );
        })}
      </span>
      {error && dialog === null && <span className={styles.error} role="alert">{error}</span>}
      {dialog === 'REMOVE' && (
        <ConfirmDialog
          title={t('imports.actions.removeTitle')}
          message={tLoose(removeConfirmKey(entry))}
          confirmLabel={label('REMOVE')}
          danger
          busy={busy}
          error={error}
          onConfirm={() => act('REMOVE')}
          onCancel={() => {
            setDialog(null);
            setError(null);
          }}
        />
      )}
      {dialog === 'LAUNCH' && (
        <LaunchPurchaseModal
          entry={entry}
          onClose={() => setDialog(null)}
          onDone={(result) => {
            if (result === 'CREATED') done('CREATED');
            else {
              setDialog(null);
              invalidate('import.resolve');
              onResolved('PURCHASE_ONLY');
            }
          }}
        />
      )}
      {dialog === 'WON' && (
        <MarkWonDialog
          count={1}
          busy={busy}
          error={error}
          onConfirm={(acquiredAt) => act('MARK_WON', acquiredAt ? { acquiredAt } : {})}
          onCancel={() => {
            setDialog(null);
            setError(null);
          }}
        />
      )}
    </>
  );
}

function EntryRow({
  entry, onNavigate, resolvedAs, onResolved, selection, failed,
}: {
  entry: ImportEntryView;
  onNavigate?: () => void;
  resolvedAs: string | null;
  onResolved: (resolution: string) => void;
  selection: { checked: boolean; onChange: (checked: boolean) => void } | null;
  failed: string | null;
}) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const { display } = entry;

  const details: string[] = [];
  if (display.variant && display.variant !== 'NORMAL') details.push(tLoose(`enums.variant.${display.variant}`));
  if (display.floatValue !== null) details.push(`float ${formatFloat(display.floatValue, language)}`);
  if (display.phase) details.push(display.phase);
  if (display.paintSeed !== null) details.push(`seed ${display.paintSeed}`);
  if (display.priceCents !== null) details.push(formatMoney(display.priceCents, display.currency, language));
  if (display.date) details.push(formatDate(display.date, language));

  const key = reasonKey(entry);
  const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? '' : formatMoney(cents, display.currency, language));
  const reason = key ? tLoose(key, { state: display.state ?? '', fee: money(display.feeCents), expected: money(display.expectedFeeCents) }) : null;
  // Sem texto próprio, o motivo pode ser um código de erro do app (ex.: FLOAT_OUT_OF_RANGE); senão mostra só o código.
  const errorKey = entry.reasonCode ? `errors.${entry.reasonCode}` : null;
  const errorText = errorKey ? tLoose(errorKey) : null;
  const reasonText = reason && reason !== key ? reason : errorText && errorText !== errorKey ? errorText : entry.reasonCode;
  const link = entryLink(entry);
  const category = (display.category ?? 'OUTRO') as Category;
  const title = display.name ?? display.marketHashName ?? t('imports.unknownItem');

  return (
    <li className={failed ? `${styles.entry} ${styles.failedEntry}` : styles.entry}>
      {selection && (
        <input
          type="checkbox"
          className={styles.check}
          checked={selection.checked}
          onChange={(event) => selection.onChange(event.target.checked)}
          aria-label={t('imports.bulk.selectEntry', { name: title })}
        />
      )}
      <ItemImage category={category} url={display.imageUrl} size={40} />
      <div className={styles.body}>
        <span className={styles.name}>{title}</span>
        {details.length > 0 && <span className={styles.details}>{details.join(' · ')}</span>}
        {reasonText && (
          <span className={entry.outcome === 'CREATED' || entry.outcome === 'MATCHED' ? `${styles.reason} ${styles.warn}` : styles.reason}>
            {reasonText}
          </span>
        )}
        {entry.outcome === 'REVERTED' && entry.linkKind === 'MATCHED' && (
          <span className={`${styles.reason} ${styles.warn}`}>{t('imports.actions.manualLaunch')}</span>
        )}
        {failed && <span className={styles.error} role="alert">{failed}</span>}
        {(link !== null || entry.candidateIds.length > 0) && (
          <span className={styles.links}>
            {link !== null && <Link href={link} onClick={onNavigate}>{t(entryLinkLabelKey(entry))}</Link>}
            {entry.candidateIds.map((id) => (
              <Link key={id} href={`/?item=${id}`} onClick={onNavigate}>{t('imports.seeCandidate', { id })}</Link>
            ))}
          </span>
        )}
        <EntryActions entry={entry} resolvedAs={resolvedAs} onResolved={onResolved} />
      </div>
    </li>
  );
}

// Barra das ações em lote (D330): só as ações que valem para todas as selecionadas. Tudo ou nada.
function BulkBar({
  selected, onDone, onFailures, onClear,
}: {
  selected: ImportEntryView[];
  onDone: (resolution: string, ids: number[]) => void;
  onFailures: (failures: Map<number, string>) => void;
  onClear: () => void;
}) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const invalidate = useInvalidate();
  const errorText = useResolveErrorText();
  const [busy, setBusy] = useState(false);
  const [won, setWon] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actions = commonBulkActions(selected);
  const ids = selected.map((e) => e.id);

  const run = (action: BulkEntryAction, acquiredAt: string | null = null) => {
    setBusy(true);
    setError(null);
    bulkResolveImportEntries({ action, entryIds: ids, ...(action === 'MARK_WON' && acquiredAt ? { acquiredAt } : {}) })
      .then(() => {
        setWon(false);
        onDone(action === 'REOPEN' ? 'REOPENED' : action === 'MARK_WON' ? 'CREATED' : 'IGNORED', ids);
        return invalidate('import.resolve');
      })
      .catch((err: unknown) => {
        if (err instanceof ApiRequestError && err.code === 'IMPORT_BULK_CONFLICT') {
          const failures = ((err.params as { failures?: { entryId: number; code: string; reason: string | null }[] })?.failures ?? []);
          onFailures(new Map(failures.map((f) => {
            const key = f.reason ? `imports.actions.conflict.${f.reason}` : `errors.${f.code}`;
            const text = tLoose(key);
            return [f.entryId, text !== key ? text : f.code];
          })));
          setError(tPlural('imports.bulk.failed', failures.length));
          return;
        }
        setError(errorText(err));
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className={styles.bulkBar} role="region" aria-label={t('imports.bulk.bar')}>
      <span>{tPlural('imports.bulk.selected', selected.length)}</span>
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          className={action === 'MARK_WON' ? `${forms.button} ${forms.primary}` : forms.button}
          disabled={busy}
          onClick={() => (action === 'MARK_WON' ? setWon(true) : run(action))}
        >
          {tLoose(`imports.actions.${action}`)}
        </button>
      ))}
      <button type="button" className={forms.button} disabled={busy} onClick={onClear}>{t('imports.bulk.clear')}</button>
      {error && !won && <span className={styles.error} role="alert">{error}</span>}
      {won && (
        <MarkWonDialog
          count={selected.length}
          busy={busy}
          error={error}
          onConfirm={(acquiredAt) => run('MARK_WON', acquiredAt)}
          onCancel={() => {
            setWon(false);
            setError(null);
          }}
        />
      )}
    </div>
  );
}

// Entradas do resumo (ou das pendências, ou das ignoradas) agrupadas por resultado, com o motivo, o link para o lançamento, as
// ações (9.4) e a seleção para as ações em lote (9.5.1b).
export default function ImportEntriesList({ entries, onNavigate, ignoredList = false }: Props) {
  const t = useT();
  const [resolved, setResolved] = useState<ReadonlyMap<number, string>>(new Map());
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  const [failures, setFailures] = useState<ReadonlyMap<number, string>>(new Map());
  const groups = ignoredList ? [{ key: 'IGNORED' as const, entries: [...entries] }] : groupEntries(entries);
  if (groups.length === 0) return null;

  const isOpen = (entry: ImportEntryView) => !resolved.has(entry.id) && bulkActionsOf(entry).length > 0;
  const markResolved = (resolution: string, ids: number[]) => {
    setResolved((current) => {
      const next = new Map(current);
      for (const id of ids) next.set(id, resolution);
      return next;
    });
    setSelectedIds(new Set());
    setFailures(new Map());
  };
  const setChecked = (ids: number[], checked: boolean) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const selected = entries.filter((entry) => selectedIds.has(entry.id) && isOpen(entry));

  return (
    <div className={styles.groups}>
      {selected.length > 0 && (
        <BulkBar selected={selected} onDone={markResolved} onFailures={setFailures} onClear={() => setSelectedIds(new Set())} />
      )}
      {groups.map((group) => {
        const selectable = group.entries.filter(isOpen);
        const allChecked = selectable.length > 0 && selectable.every((e) => selectedIds.has(e.id));
        return (
          <section key={group.key} className={styles.group} aria-label={t(`imports.groups.${group.key}`)}>
            <h3 className={styles.groupTitle}>
              {selectable.length > 1 && (
                <input
                  type="checkbox"
                  className={styles.check}
                  checked={allChecked}
                  onChange={(event) => setChecked(selectable.map((e) => e.id), event.target.checked)}
                  aria-label={t('imports.bulk.selectGroup', { group: t(`imports.groups.${group.key}`) })}
                />
              )}
              {t(`imports.groups.${group.key}`)} ({group.entries.length})
            </h3>
            <ul className={styles.list}>
              {group.entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  onNavigate={onNavigate}
                  resolvedAs={resolved.get(entry.id) ?? null}
                  onResolved={(resolution) => markResolved(resolution, [entry.id])}
                  selection={isOpen(entry) ? { checked: selectedIds.has(entry.id), onChange: (checked) => setChecked([entry.id], checked) } : null}
                  failed={failures.get(entry.id) ?? null}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
