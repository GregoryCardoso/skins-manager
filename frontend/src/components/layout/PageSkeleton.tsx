'use client';

import Skeleton from '@/components/ui/Skeleton';
import VisuallyHidden from '@/components/ui/VisuallyHidden';
import { useT } from '@/i18n/I18nProvider';
import styles from './PageSkeleton.module.css';

// Esqueleto de página inteira (fallback dos Suspense das páginas): cabeçalho + 5 linhas. O contêiner leva aria-busy e um texto só para
// leitor de tela; o Skeleton em si é decorativo.
export default function PageSkeleton() {
  const t = useT();
  return (
    <div className={styles.root} aria-busy="true" role="status" data-testid="page-skeleton">
      <VisuallyHidden>{t('common.loading')}</VisuallyHidden>
      <Skeleton width="14rem" height="2rem" radius="md" />
      <div className={styles.rows}>
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} height="2.25rem" radius="md" />
        ))}
      </div>
    </div>
  );
}
