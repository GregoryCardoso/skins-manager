'use client';

import * as Popover from '@radix-ui/react-popover';
import { useRef, useState, type ReactNode } from 'react';
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
  // Abre também ao passar o mouse (e fecha ao sair do gatilho e do balão). Teclado, clique e toque continuam iguais.
  openOnHover?: boolean;
}

const HOVER_CLOSE_MS = 150;

// Explicação acessível no teclado e no toque (substitui `title=`): abre com clique, Enter, Espaço ou toque; Esc fecha e devolve o foco.
export default function HelpTip({ topic, side = 'top', icon = 'help', className, children, openOnHover = false }: HelpTipProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const hover = openOnHover
    ? {
        onPointerEnter: (event: { pointerType: string }) => {
          if (event.pointerType !== 'mouse') return;
          cancelClose();
          setOpen(true);
        },
        onPointerLeave: (event: { pointerType: string }) => {
          if (event.pointerType !== 'mouse') return;
          cancelClose();
          closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
        },
      }
    : {};
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <IconButton icon={icon} size="sm" label={t('ui.helpTip.label', { topic })} className={className} {...hover} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={styles.content}
          side={side}
          sideOffset={6}
          collisionPadding={8}
          avoidCollisions
          aria-label={t('ui.helpTip.label', { topic })}
          {...hover}
          // Ao abrir pelo mouse, o foco fica onde está (o balão é só leitura); pelo teclado o Radix cuida do foco.
          onOpenAutoFocus={openOnHover ? (event) => event.preventDefault() : undefined}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
