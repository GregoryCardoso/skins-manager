'use client';

import Link from 'next/link';
import buttonStyles from '@/components/ui/Button.module.css';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import { useT } from '@/i18n/I18nProvider';
import styles from './not-found.module.css';

// 404: o menu já aparece ao lado (está no layout). "Itens recentes" ficam fora (D370).
export default function NotFound() {
  const t = useT();
  return (
    <>
      <PageHeader title={t('pages.notFoundTitle')} />
      <EmptyState
        icon="search"
        title={t('pages.notFoundText')}
        action={
          // Link (e não botão dentro de link) com a aparência do Button primário.
          <Link prefetch={false} href="/" className={`${buttonStyles.button} ${buttonStyles.primary} ${buttonStyles.md} ${styles.link}`}>
            {t('pages.backHome')}
          </Link>
        }
      />
    </>
  );
}
