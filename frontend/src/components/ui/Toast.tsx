'use client';

import * as RadixToast from '@radix-ui/react-toast';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '@/i18n/I18nProvider';
import Icon, { type IconName } from './Icon';
import IconButton from './IconButton';
import styles from './Toast.module.css';

export type ToastTone = 'success' | 'info' | 'danger';

export interface ToastOptions {
  tone: ToastTone;
  // Texto já traduzido.
  message: string;
  action?: { label: string; onClick: () => void };
  // Padrão 5000 ms (8000 com ação). `danger` não some sozinho.
  durationMs?: number;
}

interface ToastEntry extends ToastOptions {
  id: number;
}

interface ToastApi {
  show: (options: ToastOptions) => number;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_MS = 5000;
const WITH_ACTION_MS = 8000;
const ICON_BY_TONE: Record<ToastTone, IconName> = { success: 'circleCheck', info: 'info', danger: 'circleAlert' };

// Avisos rápidos (Radix Toast): pilha embaixo à direita (embaixo e centralizada na faixa compacta). `danger` fica até ser dispensado;
// pausa com hover e com foco; a tecla F8 leva à região. Os textos da região e do botão fechar vêm do dicionário.
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const show = useCallback((options: ToastOptions) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { ...options, id }]);
    return id;
  }, []);
  const remove = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      <RadixToast.Provider swipeDirection="right" label={t('ui.toast.region')}>
        {children}
        {toasts.map((toast) => (
          <RadixToast.Root
            key={toast.id}
            className={`${styles.toast} ${styles[toast.tone]}`}
            type={toast.tone === 'danger' ? 'foreground' : 'background'}
            duration={toast.tone === 'danger' ? Infinity : (toast.durationMs ?? (toast.action ? WITH_ACTION_MS : DEFAULT_MS))}
            onOpenChange={(open) => {
              if (!open) remove(toast.id);
            }}
          >
            <span className={styles.icon}>
              <Icon name={ICON_BY_TONE[toast.tone]} size={18} />
            </span>
            <RadixToast.Description className={styles.message}>{toast.message}</RadixToast.Description>
            {toast.action && (
              <RadixToast.Action asChild altText={toast.action.label}>
                <button type="button" className={styles.action} onClick={toast.action.onClick}>
                  {toast.action.label}
                </button>
              </RadixToast.Action>
            )}
            <RadixToast.Close asChild>
              <IconButton icon="close" size="sm" label={t('ui.toast.dismiss')} />
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className={styles.viewport} label={t('ui.toast.region')} />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast precisa estar dentro de <ToastProvider>.');
  return api;
}
