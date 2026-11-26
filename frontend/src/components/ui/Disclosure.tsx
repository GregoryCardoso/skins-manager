'use client';

import * as Collapsible from '@radix-ui/react-collapsible';
import type { ReactNode } from 'react';
import { useT } from '@/i18n/I18nProvider';
import Icon from './Icon';
import styles from './Disclosure.module.css';

export interface DisclosureProps {
  // Padrão common.moreDetails.
  label?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}

// "Mais detalhes": botão com aria-expanded e seta que gira 90°. Sem animação de altura com prefers-reduced-motion.
export default function Disclosure({ label, defaultOpen, open, onOpenChange, className, children }: DisclosureProps) {
  const t = useT();
  return (
    <Collapsible.Root defaultOpen={defaultOpen} open={open} onOpenChange={onOpenChange} className={className}>
      <Collapsible.Trigger className={styles.trigger}>
        <Icon name="chevronRight" size={16} className={styles.chevron} />
        <span>{label ?? t('common.moreDetails')}</span>
      </Collapsible.Trigger>
      <Collapsible.Content className={styles.content}>{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
