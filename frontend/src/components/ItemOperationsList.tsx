'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDate } from '@/lib/format';
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
        setNotice(t('operations.undoDone'));
        return invalidate('operation.undo');
      })
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, language)))
      .finally(() => setBusy(false));
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
          {t('operations.consumedIn', { date: formatDate(consumed.occurredAt, language), target: consumed.targetName ?? t('common.none') })}
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
            {operation.undoneAt && <span className={styles.sub}>{' · '}{t('operations.undone', { date: formatDate(operation.undoneAt, language) })}</span>}
            {operation.undoable && (
              <button type="button" className={`${forms.button} ${forms.small}`} onClick={() => { setError(null); setUndoing(operation); }}>
                {t('operations.undo')}
              </button>
            )}
            {blocked(operation) && <span className={styles.sub}>{' · '}{blocked(operation)}</span>}
          </li>
        ))}
      </ul>
      {!query.isPending && operations.length === 0 && !consumed && <p className={styles.note}>{t('operations.empty')}</p>}
      {undoing && (
        <ConfirmDialog
          title={t('operations.undoTitle')}
          message={t('operations.undoMessage')}
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
