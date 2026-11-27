'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDate, formatMoney } from '@/lib/format';
import { formatCentsInput } from '@/lib/numberInput';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { listItemOperations, undoOperation } from '@/services/api';
import { localizedOrName } from '@/lib/itemName';
import type { ItemOperation, ItemView } from '@/types/api';
import styles from './ItemHistoryBox.module.css';
import Banner from './ui/Banner';
import Button from './ui/Button';
import ConfirmDialog from './ui/ConfirmDialog';
import Spinner from './ui/Spinner';

interface Props {
  item: ItemView;
  // Com valor, o "Desfazer" fica desabilitado (alteração pendente no formulário; 12.6a). O motivo é mostrado por quem passa.
  disabledReason?: string | null;
}

// Abertura de caixa, cápsula, pacote ou terminal (10.4, D363): o desfazer e os textos mudam.
const isOpening = (operation: { kind: string }) => operation.kind === 'OPEN_CASE' || operation.kind === 'OPEN_TERMINAL';

// Operações da unidade (10.3, D362): aplicações do estoque e remoções, da mais nova para a mais antiga, com as desfeitas. Só a
// operação que o backend diz que pode ser desfeita mostra o botão; as demais mostram o motivo.
export default function ItemOperationsList({ item, disabledReason = null }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
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
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, locale)))
      .finally(() => setBusy(false));
  };

  // Separação: o modo e, na divisão, a porcentagem do pendurado (e de onde vieram os preços).
  const detachText = (detach: NonNullable<NonNullable<ItemOperation['detail']>['detach']>) => {
    if (detach.mode === 'RETURN' || !detach.share) return t('operations.detach.RETURN', { name: detach.component.name ?? '' });
    return t(`operations.detach.SPLIT_${detach.share.basis}`, {
      name: detach.component.name ?? '', share: formatCentsInput(detach.share.hangingShareBp, locale),
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
      {notice && <Banner tone="success" announce={false}>{notice}</Banner>}
      {consumed && (
        <p className={styles.note}>
          {consumed.lost
            ? t('operations.consumedInLost', { date: formatDate(consumed.occurredAt, locale) })
            : consumed.kind === 'OPEN_CASE' || consumed.kind === 'OPEN_TERMINAL'
              ? t('operations.consumedInOpen', { date: formatDate(consumed.occurredAt, locale), target: consumed.targetName ?? t('common.none') })
              : t('operations.consumedIn', { date: formatDate(consumed.occurredAt, locale), target: consumed.targetName ?? t('common.none') })}
        </p>
      )}
      {query.isPending && <Spinner size="sm" />}
      {query.error && <Banner tone="danger" onRetry={() => { void query.refetch(); }}>{errorMessageFor(query.error, tLoose, locale)}</Banner>}
      <ul className={styles.operations}>
        {operations.map((operation) => (
          <li key={operation.id} className={`${styles.operation} ${operation.undoneAt ? styles.undone : ''}`}>
            <strong>{t('operations.line', { kind: kindLabel(operation), date: formatDate(operation.occurredAt, locale) })}</strong>
            {operation.counterparts.map((c) => (
              <span key={c.itemId} className={styles.sub}>
                {' · '}{t('operations.counterpart', { role: tLoose(`operations.role.${c.role}`), name: c.name ? localizedOrName(c.name, c.localizedName) : t('common.none') })}
              </span>
            ))}
            {operation.lossUsdCents !== null && operation.lossUsdCents !== undefined && (
              <span className={styles.sub}>{' · '}{t('operations.lost', { value: formatMoney(operation.lossUsdCents, 'USD', locale) })}</span>
            )}
            {operation.endedBy && (
              <span className={styles.sub}>{' · '}{t('operations.endedBy', { date: operation.endedBy.occurredAt ? formatDate(operation.endedBy.occurredAt, locale) : t('common.none') })}</span>
            )}
            {operation.detail?.detach && (
              <span className={styles.sub}>{' · '}{detachText(operation.detail.detach)}</span>
            )}
            {operation.undoneAt && <span className={styles.sub}>{' · '}{t('operations.undone', { date: formatDate(operation.undoneAt, locale) })}</span>}
            {operation.undoneAt && operation.detail?.undoneGenerated && (
              <span className={styles.sub}>{' · '}{t('operations.undoneGenerated', { name: operation.detail.undoneGenerated.name })}</span>
            )}
            {operation.undoable && (
              <Button size="sm" disabled={disabledReason !== null} onClick={() => { setError(null); setUndoing(operation); }}>
                {t(isOpening(operation) ? 'operations.undoOpen' : 'operations.undo')}
              </Button>
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
