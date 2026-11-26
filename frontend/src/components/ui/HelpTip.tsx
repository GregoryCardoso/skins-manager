'use client';

import * as Popover from '@radix-ui/react-popover';
import type { ReactNode } from 'react';
import { useT } from '@/i18n/I18nProvider';
import type { IconName } from './Icon';
import IconButton from './IconButton';
import styles from './HelpTip.module.css';

export interface HelpTipProps {
  // Assunto da ajuda: vira o nome acessível "Ajuda: {topic}".
  topic: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  // Ícone do gatilho (padrão: o ponto de interrogação). O nome acessível continua sendo "Ajuda: {topic}".
  icon?: IconName;
  className?: string;
  // O texto da explicação.
  children: ReactNode;
}

// Explicação acessível no teclado e no toque (substitui `title=`): abre com clique, Enter, Espaço ou toque; Esc fecha e devolve o foco.
export default function HelpTip({ topic, side = 'top', icon = 'help', className, children }: HelpTipProps) {
  const t = useT();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <IconButton icon={icon} size="sm" label={t('ui.helpTip.label', { topic })} className={className} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={styles.content} side={side} sideOffset={6} collisionPadding={8} avoidCollisions>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
