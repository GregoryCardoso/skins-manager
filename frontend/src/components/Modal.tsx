'use client';

import { useEffect, useId, useRef, type ReactNode, type SyntheticEvent } from 'react';
import { useT } from '@/i18n/I18nProvider';
import styles from './Modal.module.css';

interface Props {
  title: string;
  onClose: () => void;
  // Durante o envio não fecha (Esc e botão ficam inativos).
  busy?: boolean;
  wide?: boolean;
  children: ReactNode;
}

// Modal com <dialog> nativo: showModal() prende o foco e torna o resto da página inerte; Esc fecha;
// ao desmontar, o foco volta ao elemento que abriu o modal (D118). O pai controla a abertura montando/desmontando.
export default function Modal({ title, onClose, busy = false, wide = false, children }: Props) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  const onCancel = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!busy) onClose();
  };

  return (
    <dialog ref={ref} className={`${styles.dialog} ${wide ? styles.wide : ''}`} aria-labelledby={titleId} onCancel={onCancel}>
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>{title}</h2>
        <button type="button" className={styles.close} onClick={onClose} disabled={busy} aria-label={t('common.close')}>
          ×
        </button>
      </header>
      <div className={styles.body}>{children}</div>
    </dialog>
  );
}
