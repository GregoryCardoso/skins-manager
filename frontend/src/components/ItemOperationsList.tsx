'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDate, formatMoney } from '@/lib/format';
import { formatCentsInput } from '@/lib/numberInput';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { listItemOperations, undoOperation } from '@/services/api';
import type { ItemOperation, ItemView } from '@/types/api';
import ConfirmDialog from './ConfirmDialog';
import forms from './forms.module.css';
import styles from './ItemHistoryBox.module.css';

interface Props {
  item: ItemView;
}

// Abertura de caixa, cápsula, pacote ou terminal (10.4, D363): o desfazer e os textos mudam.
const isOpening = (operation: { kind: string }) => operation.kind === 'OPEN_CASE' || operation.kind === 'OPEN_TERMINAL';

// Operações da unidade (10.3, D362): aplicações do estoque e remoções, da mais nova para a mais antiga, com as desfeitas. Só a
// operação que o backend diz que pode ser desfeita mostra o botão; as demais mostram o motivo.
export default function ItemOperationsList({ item }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const invalidate = useInvalidate();
  const query = useQuery({
    queryKey: queryKeys.items.operations(item.id),
    queryFn: ({ signal }) => listItemOperations(item.id, signal),
  });
  const [undoing, setUndoing] = useState<ItemOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const consumed = item.consumedIn;
  const operations = query.data ?? [];
  if (!consumed && !query.isPending && operations.length === 0 && !query.error) return null;

  const confirmUndo = () => {
    if (!undoing) return;
    setBusy(true);
    setError(null);
    undoOperation(undoing.id)
      .then(() => {
        setUndoing(null);
        setNotice(t(isOpening(undoing) ? 'operations.undoOpenDone' : 'operations.undoDone'));
        return invalidate('operation.undo');
      })
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, language)))
      .finally(() => setBusy(false));
  };

  // Separação: o modo e, na divisão, a porcentagem do pendurado (e de onde vieram os preços).
  const detachText = (detach: NonNullable<NonNullable<ItemOperation['detail']>['detach']>) => {
    if (detach.mode === 'RETURN' || !detach.share) return t('operations.detach.RETURN', { name: detach.component.name ?? '' });
    return t(`operations.detach.SPLIT_${detach.share.basis}`, {
      name: detach.component.name ?? '', share: formatCentsInput(detach.share.hangingShareBp, language),
    });
  };
  const kindLabel = (operation: ItemOperation) => tLoose(`operations.kind.${operation.kind}`);
  const blocked = (operation: ItemOperation) => {
    if (operation.undoneAt || operation.undoable || !operation.undoBlockedReason) return null;
    const key = `errorReasons.OPERATION_UNDO_BLOCKED_${operation.undoBlockedReason}`;
    const text = tLoose(key);
    return text !== key ? text : null;
  };

  return (
    <section className={styles.box} aria-label={t('operations.title')}>
      <h3 className={styles.title}>{t('operations.title')}</h3>
      {notice && <p className={styles.note} role="status">{notice}</p>}
      {consumed && (
        <p className={styles.note}>
          {consumed.lost
            ? t('operations.consumedInLost', { date: formatDate(consumed.occurredAt, language) })
            : consumed.kind === 'OPEN_CASE' || consumed.kind === 'OPEN_TERMINAL'
              ? t('operations.consumedInOpen', { date: formatDate(consumed.occurredAt, language), target: consumed.targetName ?? t('common.none') })
              : t('operations.consumedIn', { date: formatDate(consumed.occurredAt, language), target: consumed.targetName ?? t('common.none') })}
        </p>
      )}
      {query.isPending && <p className={styles.note}>{t('common.loading')}</p>}
      {query.error && <p className={styles.note} role="alert">{errorMessageFor(query.error, tLoose, language)}</p>}
      <ul className={styles.operations}>
        {operations.map((operation) => (
          <li key={operation.id} className={operation.undoneAt ? styles.undone : undefined}>
            <strong>{t('operations.line', { kind: kindLabel(operation), date: formatDate(operation.occurredAt, language) })}</strong>
            {operation.counterparts.map((c) => (
              <span key={c.itemId} className={styles.sub}>
                {' · '}{t('operations.counterpart', { role: tLoose(`operations.role.${c.role}`), name: c.name ?? t('common.none') })}
              </span>
            ))}
            {operation.lossUsdCents !== null && operation.lossUsdCents !== undefined && (
              <span className={styles.sub}>{' · '}{t('operations.lost', { value: formatMoney(operation.lossUsdCents, 'USD', language) })}</span>
            )}
            {operation.endedBy && (
              <span className={styles.sub}>{' · '}{t('operations.endedBy', { date: operation.endedBy.occurredAt ? formatDate(operation.endedBy.occurredAt, language) : t('common.none') })}</span>
            )}
            {operation.detail?.detach && (
              <span className={styles.sub}>{' · '}{detachText(operation.detail.detach)}</span>
            )}
            {operation.undoneAt && <span className={styles.sub}>{' · '}{t('operations.undone', { date: formatDate(operation.undoneAt, language) })}</span>}
            {operation.undoneAt && operation.detail?.undoneGenerated && (
              <span className={styles.sub}>{' · '}{t('operations.undoneGenerated', { name: operation.detail.undoneGenerated.name })}</span>
            )}
            {operation.undoable && (
              <button type="button" className={`${forms.button} ${forms.small}`} onClick={() => { setError(null); setUndoing(operation); }}>
                {t(isOpening(operation) ? 'operations.undoOpen' : 'operations.undo')}
              </button>
            )}
            {blocked(operation) && <span className={styles.sub}>{' · '}{blocked(operation)}</span>}
          </li>
        ))}
      </ul>
      {!query.isPending && operations.length === 0 && !consumed && <p className={styles.note}>{t('operations.empty')}</p>}
      {undoing && (
        <ConfirmDialog
          title={t(isOpening(undoing) ? 'operations.undoOpenTitle' : 'operations.undoTitle')}
          message={t(isOpening(undoing) ? 'operations.undoOpenMessage' : 'operations.undoMessage')}
          confirmLabel={t('operations.undoConfirm')}
          busy={busy}
          error={error}
          onCancel={() => setUndoing(null)}
          onConfirm={confirmUndo}
        />
      )}
    </section>
  );
}
