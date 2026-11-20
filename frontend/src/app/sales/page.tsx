'use client';

import { useT } from '@/i18n/I18nProvider';

export default function SalesPage() {
  const t = useT();
  return (
    <>
      <h1>{t('pages.salesTitle')}</h1>
      <p>{t('pages.salesPlaceholder')}</p>
    </>
  );
}
