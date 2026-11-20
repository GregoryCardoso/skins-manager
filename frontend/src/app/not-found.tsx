'use client';

import Link from 'next/link';
import { useT } from '@/i18n/I18nProvider';

export default function NotFound() {
  const t = useT();
  return (
    <>
      <h1>{t('pages.notFoundTitle')}</h1>
      <p>{t('pages.notFoundText')}</p>
      <Link href="/">{t('pages.backHome')}</Link>
    </>
  );
}
