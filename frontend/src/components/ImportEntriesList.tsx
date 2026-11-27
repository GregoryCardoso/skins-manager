'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDate, formatFloat, formatMoney } from '@/lib/format';
import {
  candidateLink, componentWarningsOf, entryActions, entryLink, entryLinkLabelKey, groupEntries, reasonKey, removeConfirmKey, stockCandidateOf,
  WITHOUT_PURCHASE_REASON, type EntryGroupKey,
} from '@/lib/importSummary';
import { localizedOrName } from '@/lib/itemName';
import { bulkActionsOf, commonBulkActions, type BulkEntryAction } from '@/lib/pendingActions';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, bulkResolveImportEntries, getCsfloatIntegration, reopenImportEntry, resolveImportEntry } from '@/services/api';
import type { Category, ImportEntryAction, ImportEntryView } from '@/types/api';
import ApplyComponentModal from './ApplyComponentModal';
import EntryChoice from './imports/EntryChoice';
import WithoutPurchaseSteps from './imports/WithoutPurchaseSteps';
import ItemImage from './ItemImage';
import LaunchPurchaseModal from './LaunchPurchaseModal';
import MarkWonDialog from './MarkWonDialog';
import Badge, { type BadgeTone } from './ui/Badge';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Checkbox from './ui/Checkbox';
import ConfirmDialog from './ui/ConfirmDialog';
import Disclosure from './ui/Disclosure';
import Icon from './ui/Icon';
import { useToast } from './ui/Toast';
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
  const locale = useLocale();
  return (error: unknown): string => {
    if (error instanceof ApiRequestError && (error.code === 'IMPORT_ENTRY_CONFLICT' || error.code === 'IMPORT_ENTRY_NOT_REOPENABLE')) {
      const reason = (error.params as Record<string, unknown> | undefined)?.reason;
      const key = `imports.actions.conflict.${String(reason)}`;
      const text = tLoose(key);
      if (reason && text !== key) return text;
    }
    return errorMessageFor(error, tLoose, locale);
  };
}

// Tom do Badge de cada grupo.
const GROUP_TONE: Record<EntryGroupKey | 'IGNORED', BadgeTone> = {
  CREATED: 'profit',
  MATCHED: 'info',
  POSSIBLE_DUPLICATE: 'stuck',
  REVERTED: 'loss',
  WITHOUT_PURCHASE: 'pending',
  FAILED: 'loss',
  IGNORED: 'neutral',
};

// Escolhas de uma pendência (9.4, D301; 9.5.1b, D327 a D329; 12.9): cada ação é "botão + frase". "Remover lançamento" pede confirmação;
// "Lançar compra" e "Foi drop" abrem os seus diálogos; "Ignorar" mostra um aviso com "Desfazer" (volta para pendências) quando há data de
// corte (a volta só vale com corte, seção 2.12). Depois de resolvida, mostra o resultado.
function EntryActions({ entry, resolvedAs, onResolved }: { entry: ImportEntryView; resolvedAs: string | null; onResolved: (r: string) => void }) {
  const t = useT();
  const tLoose = useTLoose();
  const invalidate = useInvalidate();
  const toast = useToast();
  const errorText = useResolveErrorText();
  const integrationQuery = useQuery({ queryKey: queryKeys.integrations.csfloat, queryFn: ({ signal }) => getCsfloatIntegration(signal) });
  const hasCutoff = integrationQuery.data?.tradesCutoffAt != null;
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'REMOVE' | 'LAUNCH' | 'WON' | 'APPLY' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actions = entryActions(entry);
  if (resolvedAs) return <span className={styles.resolved} role="status">{tLoose(`imports.actions.resolved.${resolvedAs}`)}</span>;
  if (actions.length === 0) return null;

  const done = (resolution: string) => {
    setDialog(null);
    onResolved(resolution);
    return invalidate('import.resolve');
  };
  const undoIgnore = () => {
    reopenImportEntry(entry.id)
      .then(() => invalidate('import.resolve'))
      .catch((err: unknown) => toast.show({ tone: 'danger', message: errorText(err) }));
  };
  const act = (action: ImportEntryAction, extra: { targetId?: number; acquiredAt?: string } = {}) => {
    setBusy(true);
    setError(null);
    const call = action === 'REOPEN'
      ? reopenImportEntry(entry.id).then(() => 'REOPENED')
      : resolveImportEntry(entry.id, { action, ...extra }).then((updated) => updated.resolution ?? action);
    call
      .then((resolution) => {
        if (action === 'IGNORE' && hasCutoff) {
          toast.show({ tone: 'info', message: t('imports.ignoredToast'), action: { label: t('imports.ignoredUndo'), onClick: undoIgnore } });
        }
        return done(resolution);
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };

  const label = (action: ImportEntryAction) => tLoose(`imports.actions.${action}`);
  const explain = (action: ImportEntryAction) => tLoose(`imports.actions.explain.${action}`);
  const choose = (action: ImportEntryAction) => {
    if (action === 'REMOVE') setDialog('REMOVE');
    else if (action === 'CREATE_PURCHASE') setDialog('LAUNCH');
    else if (action === 'MARK_WON') setDialog('WON');
    else if (action === 'APPLY_FROM_STOCK') setDialog('APPLY');
    else act(action);
  };

  const withoutPurchase = entry.outcome === 'FAILED' && entry.reasonCode === WITHOUT_PURCHASE_REASON;
  const stepActions: readonly ImportEntryAction[] = ['CREATE_PURCHASE', 'MARK_WON', 'IGNORE'];
  const plainActions = withoutPurchase ? actions.filter((action) => !stepActions.includes(action)) : actions;

  return (
    <>
      <div className={styles.choices}>
        {withoutPurchase && <WithoutPurchaseSteps actions={actions} busy={busy} onChoose={choose} />}
        {plainActions.map((action) => {
          if (action === 'LINK') {
            return entry.candidateIds.map((id) => (
              <EntryChoice key={`link-${id}`} label={t('imports.actions.linkTo', { id })} explain={explain('LINK')} disabled={busy} onClick={() => act('LINK', { targetId: id })} />
            ));
          }
          const tone = action === 'REMOVE' ? 'danger' : action === 'CREATE_PURCHASE' ? 'primary' : 'secondary';
          return <EntryChoice key={action} label={label(action)} explain={explain(action)} tone={tone} disabled={busy} onClick={() => choose(action)} />;
        })}
      </div>
      {error && dialog === null && <Banner tone="danger">{error}</Banner>}
      {dialog === 'REMOVE' && (
        <ConfirmDialog
          title={t('imports.actions.removeTitle')}
          message={tLoose(removeConfirmKey(entry))}
          confirmLabel={label('REMOVE')}
          tone="danger"
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
      {dialog === 'APPLY' && entry.entityId !== null && stockCandidateOf(entry) !== null && (
        <ApplyComponentModal
          target={{ id: entry.entityId, name: entry.display.name ? localizedOrName(entry.display.name, entry.display.localizedName) : entry.display.marketHashName ?? '' }}
          mode={{ type: 'retro', entryId: entry.id, sourceItemId: stockCandidateOf(entry) as number }}
          onClose={() => setDialog(null)}
          onDone={() => done('APPLIED')}
          onGone={() => setDialog(null)}
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
  const locale = useLocale();
  const { display } = entry;

  // Resumo na vista: preço e data. Os demais detalhes do item (variante, float, fase, seed) ficam em "Mais detalhes".
  const summary: string[] = [];
  if (display.priceCents !== null) summary.push(formatMoney(display.priceCents, display.currency, locale));
  if (display.date) summary.push(formatDate(display.date, locale));
  const details: string[] = [];
  if (display.variant && display.variant !== 'NORMAL') details.push(tLoose(`enums.variant.${display.variant}`));
  if (display.floatValue !== null) details.push(`float ${formatFloat(display.floatValue, locale)}`);
  if (display.phase) details.push(display.phase);
  if (display.paintSeed !== null) details.push(`seed ${display.paintSeed}`);

  const key = reasonKey(entry);
  const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? '' : formatMoney(cents, display.currency, locale));
  const reason = key ? tLoose(key, { state: display.state ?? '', fee: money(display.feeCents), expected: money(display.expectedFeeCents) }) : null;
  // Sem texto próprio, o motivo pode ser um código de erro do app (ex.: FLOAT_OUT_OF_RANGE); senão mostra só o código.
  const errorKey = entry.reasonCode ? `errors.${entry.reasonCode}` : null;
  const errorText = errorKey ? tLoose(errorKey) : null;
  const reasonText = reason && reason !== key ? reason : errorText && errorText !== errorKey ? errorText : entry.reasonCode;
  const link = entryLink(entry);
  const category = (display.category ?? 'OUTRO') as Category;
  // Aporte ou saque do extrato (9.6): o título é o tipo, e o valor e a taxa vão nos detalhes.
  const title = display.txKind ? tLoose(`imports.txKind.${display.txKind}`) : (display.name ? localizedOrName(display.name, display.localizedName) : display.marketHashName) ?? t('imports.unknownItem');
  if (display.txKind && display.feeCents !== null && display.feeCents !== undefined) {
    summary.push(t('imports.txFee', { value: formatMoney(display.feeCents, display.currency, locale) }));
  }
  const warnings = componentWarningsOf(entry);

  return (
    <li className={failed ? `${styles.entry} ${styles.failedEntry}` : styles.entry}>
      {selection && (
        <Checkbox
          label=""
          checked={selection.checked}
          onChange={selection.onChange}
          aria-label={t('imports.bulk.selectEntry', { name: title })}
          className={styles.check}
        />
      )}
      <ItemImage category={category} url={display.imageUrl} size={40} />
      <div className={styles.body}>
        <span className={styles.name}>{title}</span>
        {summary.length > 0 && <span className={styles.details}>{summary.join(' · ')}</span>}
        {reasonText && (
          <span className={entry.outcome === 'CREATED' || entry.outcome === 'MATCHED' ? `${styles.reason} ${styles.warn}` : styles.reason}>
            {reasonText}
          </span>
        )}
        {warnings.length > 0 && (
          <span className={styles.reason}>
            {t('imports.componentWarningsTitle')}: {warnings
              .map((w) => tLoose(`imports.componentWarnings.${w.code}`, { name: w.name ?? t('imports.componentUnnamed') }))
              .join('; ')}. {t('imports.componentWarningsHint')}
          </span>
        )}
        {entry.outcome === 'REVERTED' && entry.linkKind === 'MATCHED' && (
          <span className={`${styles.reason} ${styles.warn}`}>{t('imports.actions.manualLaunch')}</span>
        )}
        {details.length > 0 && (
          <Disclosure label={t('common.moreDetails')} className={styles.disclosure}>
            <span className={styles.details}>{details.join(' · ')}</span>
          </Disclosure>
        )}
        {failed && <Banner tone="danger">{failed}</Banner>}
        {(link !== null || entry.candidateIds.length > 0) && (
          <span className={styles.links}>
            {link !== null && <Link href={link} onClick={onNavigate}>{t(entryLinkLabelKey(entry))}</Link>}
            {entry.candidateIds.map((id) => (
              <Link key={id} href={candidateLink(entry, id)} onClick={onNavigate}>{t('imports.seeCandidate', { id })}</Link>
            ))}
          </span>
        )}
      </div>
      <div className={styles.side}>
        <EntryActions entry={entry} resolvedAs={resolvedAs} onResolved={onResolved} />
      </div>
    </li>
  );
}

// Barra das ações em lote (D330; 12.9): só as ações que valem para todas as selecionadas, com a frase de cada uma. Tudo ou nada.
// Fica fixa no topo da lista (embaixo, em largura total, na janela compacta). "Lançar compra" nunca entra aqui: é uma por vez.
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
          const failures = ((err.details as { failures?: { entryId: number; code: string; reason: string | null }[] } | undefined)?.failures ?? []);
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
      <span className={styles.bulkCount}>{tPlural('imports.bulk.selected', selected.length)}</span>
      <div className={styles.bulkChoices}>
        {actions.map((action) => (
          <EntryChoice
            key={action}
            label={tLoose(`imports.actions.${action}`)}
            explain={tLoose(`imports.actions.explain.${action}`)}
            tone={action === 'MARK_WON' ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={() => (action === 'MARK_WON' ? setWon(true) : run(action))}
          />
        ))}
      </div>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>{t('imports.bulk.clear')}</Button>
      {error && !won && <Banner tone="danger" className={styles.bulkError}>{error}</Banner>}
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
// escolhas (9.4; 12.9) e a seleção para as ações em lote (9.5.1b), com a dica fixa de seleção.
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
  const selectableCount = entries.filter(isOpen).length;

  return (
    <div className={styles.groups}>
      {selectableCount > 1 && (
        <p className={styles.tip} data-testid="bulk-tip">
          <Icon name="info" size={16} />
          <span>{t('imports.bulk.tip')}</span>
        </p>
      )}
      {selected.length > 0 && (
        <BulkBar selected={selected} onDone={markResolved} onFailures={setFailures} onClear={() => setSelectedIds(new Set())} />
      )}
      {groups.map((group) => {
        const selectable = group.entries.filter(isOpen);
        const checkedCount = selectable.filter((e) => selectedIds.has(e.id)).length;
        const allChecked = selectable.length > 0 && checkedCount === selectable.length;
        const groupLabel = t(`imports.groups.${group.key}`);
        return (
          <section key={group.key} className={styles.group} aria-label={groupLabel}>
            <h3 className={styles.groupTitle}>
              {selectable.length > 1 && (
                <Checkbox
                  label=""
                  checked={allChecked}
                  indeterminate={checkedCount > 0 && !allChecked}
                  onChange={(checked) => setChecked(selectable.map((e) => e.id), checked)}
                  aria-label={t('imports.bulk.selectGroup', { group: groupLabel })}
                  className={styles.check}
                />
              )}
              <Badge tone={GROUP_TONE[group.key]}>{group.entries.length}</Badge>
              <span>{groupLabel}</span>
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
