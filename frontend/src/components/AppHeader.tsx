'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useT } from '@/i18n/I18nProvider';
import styles from './AppHeader.module.css';
import HeaderControls from './HeaderControls';

export default function AppHeader() {
  const t = useT();
  const pathname = usePathname() ?? '/';
  const isSales = pathname.startsWith('/sales');
  const isInventory = pathname === '/' || pathname === '';
  const pageTitle = isSales ? t('nav.sales') : isInventory ? t('nav.inventory') : null;
  const appName = t('common.appName');

  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} · ${appName}` : appName;
  }, [pageTitle, appName]);

  return (
    <header className={styles.header}>
      <span className={styles.brand}>{appName}</span>
      <nav className={styles.nav} aria-label={t('nav.main')}>
        <Link href="/" className={isInventory ? styles.active : styles.link} aria-current={isInventory ? 'page' : undefined}>
          {t('nav.inventory')}
        </Link>
        <Link href="/sales/" className={isSales ? styles.active : styles.link} aria-current={isSales ? 'page' : undefined}>
          {t('nav.sales')}
        </Link>
      </nav>
      <HeaderControls />
    </header>
  );
}
