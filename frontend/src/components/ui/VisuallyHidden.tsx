import type { ReactNode } from 'react';
import styles from './VisuallyHidden.module.css';

// Texto só para leitor de tela (continua no fluxo de acessibilidade, some da vista).
export default function VisuallyHidden({ children, as: Tag = 'span' }: { children: ReactNode; as?: 'span' | 'div' }) {
  return <Tag className={styles.hidden}>{children}</Tag>;
}
