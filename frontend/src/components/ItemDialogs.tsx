'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useInvalidate } from '@/lib/useInvalidate';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { ApiRequestError, deleteItem, markItemForSale, markItemOffSale, unsellItem } from '@/services/api';
import { itemDisplayName, itemEnglishTitle } from '@/lib/itemName';
import type { ItemView, Store } from '@/types/api';
import ConfirmDialog from './ConfirmDialog';
import ItemFormModal from './ItemFormModal';
import ApplyComponentModal from './ApplyComponentModal';
import DetachComponentModal from './DetachComponentModal';
import OpenContainerModal from './OpenContainerModal';
import ItemHistoryBox from './ItemHistoryBox';
import ItemOperationsList from './ItemOperationsList';
import SaleReleaseNote from './SaleReleaseNote';
import Modal from './Modal';
import SellItemModal from './SellItemModal';

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; item: ItemView }
  | { kind: 'sell'; item: ItemView }
  | { kind: 'delete'; item: ItemView }
  | { kind: 'unsell'; item: ItemView }
  | { kind: 'offSale'; item: ItemView }
  | { kind: 'apply'; item: ItemView }
  | { kind: 'open'; item: ItemView }
  | { kind: 'detach'; item: ItemView; componentId?: number }
  | { kind: 'registerKey'; keyName: string }
  | { kind: 'history'; item: ItemView };

export interface ItemDialogsApi {
  openCreate: () => void;
  openEdit: (item: ItemView) => void;
  openSell: (item: ItemView) => void;
  openUnsell: (item: ItemView) => void;
  openDelete: (item: ItemView) => void;
  // "Não está à venda" pede confirmação (o giro recomeça ao voltar); "Colocar à venda" age direto (D266).
  openOffSale: (item: ItemView) => void;
  // "Aplicar do estoque" (10.3, D362): sticker, chaveiro, Sticker Slab ou patch em estoque vira componente deste item.
  openApply: (item: ItemView) => void;
  // Abrir caixa, cápsula, pacote ou terminal (10.4, D363) e o atalho "Cadastrar chave" (cadastro em OUTRO com o nome sugerido).
  openOpen: (item: ItemView) => void;
  // "Separar chaveiro/slab" da arma (10.7, D366).
  openDetach: (item: ItemView, componentId?: number) => void;
  openRegisterKey: (keyName: string) => void;
  putForSale: (item: ItemView) => void;
  // Id do item cujo "Colocar à venda" está em andamento (o botão fica desabilitado).
  forSalePendingId: number | null;
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
  const locale = useLocale();
  const invalidate = useInvalidate();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [forSalePendingId, setForSalePendingId] = useState<number | null>(null);
  const forSalePendingRef = useRef<number | null>(null);

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

  const runConfirm = (
    action: Promise<unknown>,
    doneMessage: string,
    invalidation: 'item.delete' | 'item.unsell' | 'item.offSale',
  ) => {
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
        // Já vendido em outra aba/janela: recarrega a lista e mostra a mensagem traduzida (adendo 4 da revisão 8.6/8.7).
        if (invalidation === 'item.offSale' && err instanceof ApiRequestError && err.code === 'ITEM_ALREADY_SOLD') {
          invalidate('item.offSale');
        }
        setConfirmBusy(false);
        setConfirmError(errorMessageFor(err, tLoose, locale));
      });
  };

  // Sem confirmação: voltar à venda é reversível. Erros viram o aviso da página.
  // O botão fica travado durante a requisição, para evitar clique duplo (adendo 4 da revisão 8.6/8.7).
  const putForSale = (item: ItemView) => {
    if (forSalePendingRef.current !== null) return;
    forSalePendingRef.current = item.id;
    setForSalePendingId(item.id);
    markItemForSale(item.id)
      .finally(() => {
        forSalePendingRef.current = null;
        setForSalePendingId(null);
      })
      .then(() => {
        invalidate('item.backOnSale');
        setNotice(t('inventory.forSaleDone', { name: itemDisplayName(item) }));
      })
      .catch((err: unknown) => {
        if (err instanceof ApiRequestError && err.code === 'ITEM_NOT_FOUND') {
          itemGone();
          return;
        }
        if (err instanceof ApiRequestError && err.code === 'ITEM_ALREADY_SOLD') invalidate('item.sell');
        setNotice(errorMessageFor(err, tLoose, locale));
      });
  };

  const dialogs = (
    <>
      {dialog?.kind === 'create' && (
        <ItemFormModal stores={stores} onClose={closeDialog} onSaved={finish} onGone={itemGone} />
      )}
      {dialog?.kind === 'edit' && (
        <ItemFormModal
          item={dialog.item}
          stores={stores}
          onClose={closeDialog}
          onSaved={finish}
          onGone={itemGone}
          onDetach={(item, componentId) => setDialog({ kind: 'detach', item, componentId })}
        />
      )}
      {dialog?.kind === 'sell' && (
        <SellItemModal item={dialog.item} stores={stores} onClose={closeDialog} onSold={finish} onGone={itemGone} />
      )}
      {dialog?.kind === 'history' && (
        <Modal title={t('history.title', { name: itemDisplayName(dialog.item) })} onClose={closeDialog}>
          <SaleReleaseNote item={dialog.item} />
          <ItemHistoryBox stats={dialog.item.stats} />
          <ItemOperationsList item={dialog.item} />
        </Modal>
      )}
      {dialog?.kind === 'registerKey' && (
        <ItemFormModal preset={{ name: dialog.keyName }} stores={stores} onClose={closeDialog} onSaved={finish} onGone={itemGone} />
      )}
      {dialog?.kind === 'open' && (
        <OpenContainerModal
          item={dialog.item}
          stores={stores}
          onClose={closeDialog}
          onDone={finish}
          onGone={itemGone}
          onRegisterKey={(keyName) => setDialog({ kind: 'registerKey', keyName })}
        />
      )}
      {dialog?.kind === 'detach' && (
        <DetachComponentModal item={dialog.item} componentId={dialog.componentId} onClose={closeDialog} onDone={finish} onGone={itemGone} />
      )}
      {dialog?.kind === 'apply' && (
        <ApplyComponentModal
          target={{ id: dialog.item.id, name: itemDisplayName(dialog.item) }}
          mode={{ type: 'stock' }}
          onClose={closeDialog}
          onDone={finish}
          onGone={itemGone}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={t('confirm.deleteTitle')}
          message={t('confirm.deleteMessage', { name: itemDisplayName(dialog.item) })}
          confirmLabel={t('confirm.confirmDelete')}
          danger
          busy={confirmBusy}
          error={confirmError}
          onCancel={closeDialog}
          onConfirm={() => runConfirm(deleteItem(dialog.item.id), t('confirm.deleted'), 'item.delete')}
        />
      )}
      {dialog?.kind === 'offSale' && (
        <ConfirmDialog
          title={t('inventory.offSaleConfirmTitle')}
          message={t('inventory.offSaleConfirmMessage')}
          confirmLabel={t('inventory.actions.offSale')}
          busy={confirmBusy}
          error={confirmError}
          onCancel={closeDialog}
          onConfirm={() => runConfirm(markItemOffSale(dialog.item.id), t('inventory.offSaleDone', { name: itemDisplayName(dialog.item) }), 'item.offSale')}
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
    openOffSale: (item) => setDialog({ kind: 'offSale', item }),
    openApply: (item) => setDialog({ kind: 'apply', item }),
    openOpen: (item) => setDialog({ kind: 'open', item }),
    openDetach: (item, componentId) => setDialog({ kind: 'detach', item, componentId }),
    openRegisterKey: (keyName) => setDialog({ kind: 'registerKey', keyName }),
    putForSale,
    forSalePendingId,
    openHistory: (item) => setDialog({ kind: 'history', item }),
    notice,
    dismissNotice: () => setNotice(null),
    dialogs,
  };
}
