import { useId, type ReactNode } from 'react';
import styles from './Panel.module.css';

export interface PanelProps {
  title?: string;
  // Nível do título (h2 ou h3), para respeitar a hierarquia da página.
  headingLevel?: 2 | 3;
  hint?: ReactNode;
  // Botões do cabeçalho. Abaixo de 720 px (largura do próprio painel) descem para baixo do título.
  actions?: ReactNode;
  as?: 'section' | 'div';
  className?: string;
  children: ReactNode;
}

// Moldura de bloco da tela (o ".panel" do protótipo). `section` com aria-labelledby no título.
export default function Panel({ title, headingLevel = 2, hint, actions, as: Tag = 'section', className, children }: PanelProps) {
  const titleId = useId();
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const hasHead = Boolean(title || actions || hint);
  return (
    <Tag className={`${styles.panel} ${className ?? ''}`} aria-labelledby={title ? titleId : undefined}>
      {hasHead && (
        <header className={styles.head}>
          <div className={styles.headText}>
            {title && (
              <Heading id={titleId} className={styles.title}>
                {title}
              </Heading>
            )}
            {hint && <div className={styles.hint}>{hint}</div>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      <div className={styles.body}>{children}</div>
    </Tag>
  );
}
