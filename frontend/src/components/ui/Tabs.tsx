'use client';

import * as RadixTabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import styles from './Tabs.module.css';

export interface TabItem {
  value: string;
  label: string;
  count?: number;
  badge?: ReactNode;
}

export interface TabsProps {
  // aria-label da lista de abas.
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: TabItem[];
  // Os painéis (TabPanel).
  children?: ReactNode;
  className?: string;
}

// Abas (Radix Tabs): setas com ativação automática. Em janela estreita a lista rola na horizontal e a aba em foco fica visível.
export default function Tabs({ label, value, onChange, items, children, className }: TabsProps) {
  return (
    <RadixTabs.Root value={value} onValueChange={onChange} activationMode="automatic" className={className}>
      <div className={styles.scroller}>
        <RadixTabs.List aria-label={label} className={styles.list}>
          {items.map((item) => (
            <RadixTabs.Trigger
              key={item.value}
              value={item.value}
              className={styles.tab}
              onFocus={(event) => event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })}
            >
              <span className={styles.text}>{item.label}</span>
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
