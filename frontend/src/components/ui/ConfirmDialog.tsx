'use client';

import { useId, useRef, type ReactNode } from 'react';
import { useT } from '@/i18n/I18nProvider';
import Button from './Button';
import Dialog from './Dialog';
import Icon from './Icon';
import styles from './ConfirmDialog.module.css';

export interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  // Verbo claro ("Excluir item", "Desfazer venda"): nunca "OK" nem "Sim".
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  // Efeito da ação (por exemplo, a prévia do que muda).
  details?: ReactNode;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// Confirmação antes de uma ação destrutiva. role="alertdialog"; foco inicial em Cancelar no danger. O erro aparece dentro do diálogo.
export default function ConfirmDialog({ title, message, confirmLabel, tone = 'primary', details, busy = false, error, onConfirm, onCancel }: ConfirmDialogProps) {
  const t = useT();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title={title}
      size="sm"
      busy={busy}
      onClose={onCancel}
      role="alertdialog"
      describedBy={messageId}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        (tone === 'danger' ? cancelRef : confirmRef).current?.focus();
      }}
      footer={
        <>
          <Button ref={cancelRef} onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button ref={confirmRef} variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <div id={messageId}>{message}</div>
        {details && <div className={styles.details}>{details}</div>}
        {error && (
          <div role="alert" className={styles.error}>
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Dialog>
  );
}
