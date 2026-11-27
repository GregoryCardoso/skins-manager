'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import { useRef, type ReactNode } from 'react';
import { useT } from '@/i18n/I18nProvider';
import IconButton from './IconButton';
import styles from './Dialog.module.css';

export interface DialogProps {
  // Padrão true: montar = abrir (o padrão atual das telas continua valendo).
  open?: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg';
  // Durante o envio: Esc e botão fechar ficam inativos.
  busy?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  /** @internal usado pelo ConfirmDialog */
  role?: 'dialog' | 'alertdialog';
  /** @internal */
  describedBy?: string;
  /** @internal */
  onOpenAutoFocus?: (event: Event) => void;
  className?: string;
}

// Diálogo modal (Radix Dialog). Foco preso; ao fechar, o foco volta a quem abriu (D118); Esc fecha (menos com busy);
// clicar fora NÃO fecha (protege formulário preenchido). Só o corpo rola; cabeçalho e rodapé ficam fixos.
export default function Dialog({ open = true, onClose, title, description, size = 'md', busy = false, footer, children, role, describedBy, onOpenAutoFocus, className }: DialogProps) {
  const t = useT();
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Grava quem tinha o foco no momento em que o diálogo abre (antes de o Radix mover o foco para dentro).
  if (open && !wasOpen.current) {
    opener.current = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpen.current = open;

  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content
          {...(role ? { role } : {})}
          className={`${styles.content} ${styles[size]} ${className ?? ''}`}
          {...(describedBy !== undefined ? { 'aria-describedby': describedBy } : description ? {} : { 'aria-describedby': undefined })}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onOpenAutoFocus={(event) => {
            if (onOpenAutoFocus) {
              onOpenAutoFocus(event);
              return;
            }
            const first = bodyRef.current?.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])');
            if (first && !bodyRef.current?.contains(document.activeElement)) {
              event.preventDefault();
              first.focus();
              return;
            }
            // Sem campo: o foco vai ao próprio diálogo (o leitor de tela lê o título) e não ao botão de fechar, cuja dica abriria no foco
            // e engoliria o primeiro Esc (o Esc fecha primeiro a dica, depois o diálogo).
            if (!first) {
              const content = bodyRef.current?.parentElement;
              if (content) {
                event.preventDefault();
                content.focus();
              }
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (opener.current && opener.current.isConnected) opener.current.focus();
          }}
        >
          <header className={styles.header}>
            <RadixDialog.Title className={styles.title}>{title}</RadixDialog.Title>
            <IconButton icon="close" label={t('common.close')} disabled={busy} onClick={onClose} />
          </header>
          {description && <RadixDialog.Description className={styles.description}>{description}</RadixDialog.Description>}
          <div ref={bodyRef} className={styles.body}>
            {children}
          </div>
          {footer && <footer className={styles.footer}>{footer}</footer>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
