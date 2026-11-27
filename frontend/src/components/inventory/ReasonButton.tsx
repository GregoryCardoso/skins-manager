'use client';

import { useId, type ReactNode } from 'react';
import Button from '../ui/Button';
import Tooltip from '../ui/Tooltip';
import styles from './inventory.module.css';

interface Props {
  disabled: boolean;
  // Motivo de estar desativado. Fica ligado ao botão por `aria-describedby` (leitor de tela) e na dica, que abre no
  // foco e no hover (D370, 12.12, I2). O botão continua focável (aria-disabled), então o motivo chega ao teclado.
  reason?: string;
  variant: 'primary' | 'secondary';
  loading?: boolean;
  onClick: () => void;
  children: ReactNode;
}

// Botão de ação da linha do inventário: com motivo, o desativado explica por que.
export default function ReasonButton({ disabled, reason, variant, loading, onClick, children }: Props) {
  const reasonId = useId();
  const explained = disabled && reason !== undefined;
  const button = (
    <Button
      size="sm"
      variant={variant}
      loading={loading}
      aria-disabled={disabled ? true : undefined}
      aria-describedby={explained ? reasonId : undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      {children}
    </Button>
  );
  if (!explained) return button;
  return (
    <>
      <Tooltip content={reason}>{button}</Tooltip>
      <span id={reasonId} className={styles.srOnly}>
        {reason}
      </span>
    </>
  );
}
