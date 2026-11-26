'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactElement } from 'react';
import { useT } from '@/i18n/I18nProvider';
import Icon, { type IconName } from './Icon';
import IconButton from './IconButton';
import styles from './Menu.module.css';

export type MenuEntry =
  | { type?: 'item'; id: string; label: string; icon?: IconName; onSelect: () => void; disabled?: boolean; disabledReason?: string; tone?: 'danger' }
  | { type: 'separator' }
  | { type: 'label'; label: string };

export interface MenuProps {
  // Nome acessível do gatilho padrão (padrão ui.menu.moreActions).
  label?: string;
  trigger?: ReactElement;
  items: MenuEntry[];
  align?: 'start' | 'end';
}

// Menu "⋯ Mais ações" (Radix DropdownMenu): setas, Home/End, busca pela primeira letra, Esc devolve o foco ao gatilho.
// Item desabilitado mostra o motivo como segunda linha visível (tooltip não funciona em item desabilitado).
export default function Menu({ label, trigger, items, align = 'end' }: MenuProps) {
  const t = useT();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger ?? <IconButton icon="more" label={label ?? t('ui.menu.moreActions')} />}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={styles.content} align={align} sideOffset={4} collisionPadding={8} avoidCollisions>
          {items.map((entry, index) => {
            if (entry.type === 'separator') return <DropdownMenu.Separator key={`sep-${index}`} className={styles.separator} />;
            if (entry.type === 'label') {
              return (
                <DropdownMenu.Label key={`label-${index}`} className={styles.label}>
                  {entry.label}
                </DropdownMenu.Label>
              );
            }
            return (
              <DropdownMenu.Item
                key={entry.id}
                className={`${styles.item} ${entry.tone === 'danger' ? styles.danger : ''}`}
                disabled={entry.disabled}
                onSelect={() => entry.onSelect()}
              >
                {entry.icon && <Icon name={entry.icon} size={16} />}
                <span className={styles.text}>
                  <span>{entry.label}</span>
                  {entry.disabled && entry.disabledReason && <span className={styles.reason}>{entry.disabledReason}</span>}
                </span>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
