'use client';

import { useT } from '@/i18n/I18nProvider';
import styles from './forms.module.css';
import Modal from './Modal';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// Confirmação antes de uma ação destrutiva (excluir item, desfazer venda).
export default function ConfirmDialog({ title, message, confirmLabel, danger = false, busy = false, error, onConfirm, onCancel }: Props) {
  const t = useT();
  return (
    <Modal title={title} onClose={onCancel} busy={busy}>
      <div className={styles.form}>
        <p>{message}</p>
        {error && <div className={styles.topError} role="alert">{error}</div>}
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onCancel} disabled={busy} autoFocus>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`${styles.button} ${danger ? styles.danger : styles.primary}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? t('common.saving') : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
