'use client';

import { useEffect, type ReactNode } from 'react';
import { useT } from '@/i18n/I18nProvider';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  // Botões da página, à direita. Quebram para baixo quando a largura do conteúdo é menor que `md` (720).
  actions?: ReactNode;
  headingId?: string;
  // O subtítulo muda sozinho (contagem de itens): anunciado com educação (aria-live="polite").
  liveSubtitle?: boolean;
}

// Cabeçalho de página (D370, 12.4): o único <h1> e a única fonte do título da aba ("{página} · {app}", na ordem do idioma).
export default function PageHeader({ title, subtitle, actions, headingId, liveSubtitle = false }: PageHeaderProps) {
  const t = useT();
  const appName = t('common.appName');
  const documentTitle = t('layout.documentTitle', { page: title, app: appName });

  // Ao sair, devolve o título anterior: a tela "o app não está respondendo" aparece por cima da página,
  // que continua montada (escondida); quando a conexão volta, a aba precisa voltar ao título da página.
  useEffect(() => {
    const previous = document.title;
    document.title = documentTitle;
    return () => {
      document.title = previous;
    };
  }, [documentTitle]);

  const hasSubtitle = subtitle !== undefined && subtitle !== null && subtitle !== false && subtitle !== '';
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.titles}>
          <h1 id={headingId} className={styles.title} tabIndex={-1}>{title}</h1>
          {hasSubtitle && (
            <div className={styles.subtitle} aria-live={liveSubtitle ? 'polite' : undefined}>
              {subtitle}
            </div>
          )}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
    </div>
  );
}
