'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useInvalidate } from '@/lib/useInvalidate';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { ApiRequestError, deleteItem, unsellItem } from '@/services/api';
import type { ItemView, Store } from '@/types/api';
import ConfirmDialog from './ConfirmDialog';
import ItemFormModal from './ItemFormModal';
import ItemHistoryBox from './ItemHistoryBox';
import SaleReleaseNote from './SaleReleaseNote';
import Modal from './Modal';
import SellItemModal from './SellItemModal';

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; item: ItemView }
  | { kind: 'sell'; item: ItemView }
  | { kind: 'delete'; item: ItemView }
  | { kind: 'unsell'; item: ItemView }
  | { kind: 'history'; item: ItemView };

export interface ItemDialogsApi {
  openCreate: () => void;
  openEdit: (item: ItemView) => void;
  openSell: (item: ItemView) => void;
  openUnsell: (item: ItemView) => void;
  openDelete: (item: ItemView) => void;
  openHistory: (item: ItemView) => void;
  notice: string | null;
  dismissNotice: () => void;
  // Os modais e confirmações; renderize uma vez na página.
  dialogs: ReactNode;
}

// Modais e confirmações de item compartilhados pelo inventário e pela página de vendas (D129).
// Sucesso -> fecha, mostra a mensagem e invalida as consultas (D259); ITEM_NOT_FOUND -> avisa e atualiza as telas.
export function useItemDialogs(stores: Store[]): ItemDialogsApi {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const invalidate = useInvalidate();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const closeDialog = useCallback(() => {
    setDialog(null);
    setConfirmBusy(false);
    setConfirmError(null);
  }, []);

  const finish = useCallback(
    (message: string) => {
      closeDialog();
      setNotice(message);
    },
    [closeDialog],
  );

  const itemGone = useCallback(() => {
    invalidate('item.delete');
    finish(t('inventory.itemGone'));
  }, [finish, invalidate, t]);

  const runConfirm = (action: Promise<unknown>, doneMessage: string, invalidation: 'item.delete' | 'item.unsell') => {
    setConfirmBusy(true);
    setConfirmError(null);
    action
      .then(() => {
        invalidate(invalidation);
        finish(doneMessage);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiRequestError && err.code === 'ITEM_NOT_FOUND') {
          itemGone();
          return;
        }
        setConfirmBusy(false);
        setConfirmError(errorMessageFor(err, tLoose, language));
      });
  };

  const dialogs = (
    <>
      {dialog?.kind === 'create' && (
        <ItemFormModal stores={stores} onClose={closeDialog} onSaved={finish} onGone={itemGone} />
      )}
      {dialog?.kind === 'edit' && (
        <ItemFormModal item={dialog.item} stores={stores} onClose={closeDialog} onSaved={finish} onGone={itemGone} />
      )}
      {dialog?.kind === 'sell' && (
        <SellItemModal item={dialog.item} stores={stores} onClose={closeDialog} onSold={finish} onGone={itemGone} />
      )}
      {dialog?.kind === 'history' && (
        <Modal title={t('history.title', { name: dialog.item.name })} onClose={closeDialog}>
          <SaleReleaseNote item={dialog.item} />
          <ItemHistoryBox stats={dialog.item.stats} />
        </Modal>
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={t('confirm.deleteTitle')}
          message={t('confirm.deleteMessage', { name: dialog.item.name })}
          confirmLabel={t('confirm.confirmDelete')}
          danger
          busy={confirmBusy}
          error={confirmError}
          onCancel={closeDialog}
          onConfirm={() => runConfirm(deleteItem(dialog.item.id), t('confirm.deleted'), 'item.delete')}
        />
      )}
      {dialog?.kind === 'unsell' && (
        <ConfirmDialog
          title={t('confirm.unsellTitle')}
          message={t('confirm.unsellMessage')}
          confirmLabel={t('confirm.confirmUnsell')}
          busy={confirmBusy}
          error={confirmError}
          onCancel={closeDialog}
          onConfirm={() => runConfirm(unsellItem(dialog.item.id), t('confirm.unsold'), 'item.unsell')}
        />
      )}
    </>
  );

  return {
    openCreate: () => setDialog({ kind: 'create' }),
    openEdit: (item) => setDialog({ kind: 'edit', item }),
    openSell: (item) => setDialog({ kind: 'sell', item }),
    openUnsell: (item) => setDialog({ kind: 'unsell', item }),
    openDelete: (item) => setDialog({ kind: 'delete', item }),
    openHistory: (item) => setDialog({ kind: 'history', item }),
    notice,
    dismissNotice: () => setNotice(null),
    dialogs,
  };
}
