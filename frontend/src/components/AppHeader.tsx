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
  const isProfit = pathname.startsWith('/profit');
  const isStores = pathname.startsWith('/stores');
  const isSettings = pathname.startsWith('/settings');
  const isInventory = pathname === '/' || pathname === '';
  const pageTitle = isSales ? t('nav.sales') : isProfit ? t('nav.profit') : isStores ? t('nav.stores') : isSettings ? t('nav.settings') : isInventory ? t('nav.inventory') : null;
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
        <Link href="/profit/" className={isProfit ? styles.active : styles.link} aria-current={isProfit ? 'page' : undefined}>
          {t('nav.profit')}
        </Link>
        <Link href="/stores/" className={isStores ? styles.active : styles.link} aria-current={isStores ? 'page' : undefined}>
          {t('nav.stores')}
        </Link>
        <Link href="/settings/" className={isSettings ? styles.active : styles.link} aria-current={isSettings ? 'page' : undefined}>
          {t('nav.settings')}
        </Link>
      </nav>
      <HeaderControls />
    </header>
  );
}
