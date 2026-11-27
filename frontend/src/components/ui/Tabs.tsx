'use client';

import * as RadixTabs from '@radix-ui/react-tabs';
import { useId, type ReactNode } from 'react';
import styles from './Tabs.module.css';

export interface TabItem {
  value: string;
  label: string;
  count?: number;
  badge?: ReactNode;
  // Segunda linha com o estado da aba (Configurações, 12.8): visível sem abrir a aba.
  description?: string;
}

export interface TabsProps {
  // aria-label da lista de abas.
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: TabItem[];
  // `vertical`: o índice fica em coluna (setas para cima e para baixo). Padrão horizontal.
  orientation?: 'horizontal' | 'vertical';
  // Os painéis (TabPanel).
  children?: ReactNode;
  className?: string;
}

// Abas (Radix Tabs): setas com ativação automática. Em janela estreita a lista rola na horizontal e a aba em foco fica visível.
export default function Tabs({ label, value, onChange, items, orientation = 'horizontal', children, className }: TabsProps) {
  const vertical = orientation === 'vertical';
  const uid = useId();
  // Com subtítulo, o nome acessível da aba é só o título; o subtítulo vira descrição (B7, 12.11).
  const idOf = (value: string, part: 'name' | 'desc') => `${uid}-${part}-${value.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={onChange}
      activationMode="automatic"
      orientation={orientation}
      className={`${vertical ? styles.rootVertical : ''} ${className ?? ''}`}
    >
      <div className={vertical ? styles.scrollerVertical : styles.scroller}>
        <RadixTabs.List aria-label={label} className={vertical ? styles.listVertical : styles.list}>
          {items.map((item) => (
            <RadixTabs.Trigger
              key={item.value}
              value={item.value}
              className={`${styles.tab} ${vertical ? styles.tabVertical : ''}`}
              aria-labelledby={item.description ? idOf(item.value, 'name') : undefined}
              aria-describedby={item.description ? idOf(item.value, 'desc') : undefined}
              onFocus={(event) => event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })}
            >
              <span className={styles.text}>
                <span id={item.description ? idOf(item.value, 'name') : undefined} className={styles.name}>{item.label}</span>
                {item.description && <span id={idOf(item.value, 'desc')} className={styles.description}>{item.description}</span>}
              </span>
              {item.count !== undefined && <span className={styles.count}>{item.count}</span>}
              {item.badge}
            </RadixTabs.Trigger>
          ))}
        </RadixTabs.List>
      </div>
      {children}
    </RadixTabs.Root>
  );
}

export function TabPanel({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <RadixTabs.Content value={value} className={`${styles.panel} ${className ?? ''}`}>
      {children}
    </RadixTabs.Content>
  );
}
