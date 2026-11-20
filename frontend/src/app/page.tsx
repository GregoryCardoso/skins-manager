'use client';

import SystemStatus from '@/components/SystemStatus';
import { useT } from '@/i18n/I18nProvider';

export default function InventoryPage() {
  const t = useT();
  return (
    <>
      <SystemStatus />
      <h1>{t('pages.inventoryTitle')}</h1>
      <p>{t('pages.inventoryPlaceholder')}</p>
    </>
  );
}
