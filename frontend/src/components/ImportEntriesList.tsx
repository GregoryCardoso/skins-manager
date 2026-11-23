'use client';

import Link from 'next/link';
import { useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDate, formatFloat, formatMoney } from '@/lib/format';
import { entryActions, entryLink, entryLinkLabelKey, groupEntries, reasonKey, removeConfirmKey } from '@/lib/importSummary';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, resolveImportEntry } from '@/services/api';
import type { Category, ImportEntryAction, ImportEntryView } from '@/types/api';
import ConfirmDialog from './ConfirmDialog';
import ItemImage from './ItemImage';
import forms from './forms.module.css';
import styles from './ImportEntriesList.module.css';

interface Props {
  entries: readonly ImportEntryView[];
  // Chamado ao seguir um link para o inventário (fecha o modal que contém a lista).
  onNavigate?: () => void;
}

// Mensagem do erro ao resolver: o conflito traz o motivo (ex.: ITEM_SOLD_IN_APP) com texto próprio.
function useResolveErrorText() {
  const tLoose = useTLoose();
  const language = useLanguage();
  return (error: unknown): string => {
    if (error instanceof ApiRequestError && error.code === 'IMPORT_ENTRY_CONFLICT') {
      const reason = (error.params as Record<string, unknown> | undefined)?.reason;
      const key = `imports.actions.conflict.${String(reason)}`;
      const text = tLoose(key);
      if (reason && text !== key) return text;
    }
    return errorMessageFor(error, tLoose, language);
  };
}

// Botões de uma pendência aberta (9.4, D301). "Remover lançamento" pede confirmação. Depois de resolvida, mostra o resultado
// (a lista do resumo é estática; a da página Importações recarrega pela invalidação).
function EntryActions({ entry }: { entry: ImportEntryView }) {
  const t = useT();
  const tLoose = useTLoose();
  const invalidate = useInvalidate();
  const errorText = useResolveErrorText();
  const [resolvedAs, setResolvedAs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actions = entryActions(entry);
  if (resolvedAs) return <span className={styles.resolved} role="status">{tLoose(`imports.actions.resolved.${resolvedAs}`)}</span>;
  if (actions.length === 0) return null;

  const act = (action: ImportEntryAction, targetId?: number) => {
    setBusy(true);
    setError(null);
    resolveImportEntry(entry.id, targetId === undefined ? { action } : { action, targetId })
      .then((updated) => {
        setConfirmRemove(false);
        setResolvedAs(updated.resolution ?? action);
        return invalidate('import.resolve');
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };

  const label = (action: ImportEntryAction) => t(`imports.actions.${action}`);
  return (
    <>
      <span className={styles.actions}>
        {actions.map((action) => {
          if (action === 'LINK') {
            return entry.candidateIds.map((id) => (
              <button key={`link-${id}`} type="button" className={forms.button} disabled={busy} onClick={() => act('LINK', id)}>
                {t('imports.actions.linkTo', { id })}
              </button>
            ));
          }
          const danger = action === 'REMOVE';
          return (
            <button
              key={action}
              type="button"
              className={danger ? `${forms.button} ${forms.danger}` : forms.button}
              disabled={busy}
              onClick={() => (action === 'REMOVE' ? setConfirmRemove(true) : act(action))}
            >
              {label(action)}
            </button>
          );
        })}
      </span>
      {error && !confirmRemove && <span className={styles.error} role="alert">{error}</span>}
      {confirmRemove && (
        <ConfirmDialog
          title={t('imports.actions.removeTitle')}
          message={tLoose(removeConfirmKey(entry))}
          confirmLabel={label('REMOVE')}
          danger
          busy={busy}
          error={error}
          onConfirm={() => act('REMOVE')}
          onCancel={() => {
            setConfirmRemove(false);
            setError(null);
          }}
        />
      )}
    </>
  );
}

function EntryRow({ entry, onNavigate }: { entry: ImportEntryView; onNavigate?: () => void }) {
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
    <li className={styles.entry}>
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
        {(link !== null || entry.candidateIds.length > 0) && (
          <span className={styles.links}>
            {link !== null && <Link href={link} onClick={onNavigate}>{t(entryLinkLabelKey(entry))}</Link>}
            {entry.candidateIds.map((id) => (
              <Link key={id} href={`/?item=${id}`} onClick={onNavigate}>{t('imports.seeCandidate', { id })}</Link>
            ))}
          </span>
        )}
        <EntryActions entry={entry} />
      </div>
    </li>
  );
}

// Entradas do resumo (ou das pendências) agrupadas por resultado, com o motivo, o link para o lançamento e as ações (9.4).
export default function ImportEntriesList({ entries, onNavigate }: Props) {
  const t = useT();
  const groups = groupEntries(entries);
  if (groups.length === 0) return null;
  return (
    <div className={styles.groups}>
      {groups.map((group) => (
        <section key={group.key} className={styles.group} aria-label={t(`imports.groups.${group.key}`)}>
          <h3 className={styles.groupTitle}>{t(`imports.groups.${group.key}`)} ({group.entries.length})</h3>
          <ul className={styles.list}>
            {group.entries.map((entry) => <EntryRow key={entry.id} entry={entry} onNavigate={onNavigate} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}
