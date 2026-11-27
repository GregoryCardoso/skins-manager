'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useT, useTPlural } from '@/i18n/I18nProvider';
import styles from './ImportButton.module.css';
import ImportSetupModal from './ImportSetupModal';
import Badge from './ui/Badge';
import { useReviewCount } from './layout/useReviewCount';
import { useCsfloatImport } from './useCsfloatImport';

// Botão "Importar do CSFloat" (Inventário, Vendas, Aportes e Saques; 9.2, D318). Com o CSFloat ainda não ligado (sem chave ou sem
// loja), vira "Importar automaticamente" e abre um modal simples que leva às configurações (pedido do usuário). Ao lado, com algo
// esperando conferência, um link com o selo "N para conferir" leva a /imports/ (12.4); o botão em si continua só importando.
export default function ImportButton() {
  const t = useT();
  const tPlural = useTPlural();
  const { running, disabledReason, start, dialogs } = useCsfloatImport();
  const [setupOpen, setSetupOpen] = useState(false);
  const reviewCount = useReviewCount() ?? 0;
  const needsSetup = disabledReason === 'NO_KEY' || disabledReason === 'NO_STORE';

  // O mesmo tom do selo do menu (--stuck). O tom `pending` é do saldo pendente (tem listras e não se lê com texto por cima).
  const reviewLink = reviewCount > 0 && (
    <Link prefetch={false} href="/imports/" className={styles.reviewLink}>
      <Badge tone="stuck">{tPlural('settings.integrations.csfloat.openEntries', reviewCount)}</Badge>
    </Link>
  );

  if (needsSetup) {
    return (
      <>
        <button type="button" className={styles.button} onClick={() => setSetupOpen(true)}>{t('csfloatSetup.button')}</button>
        {reviewLink}
        {setupOpen && <ImportSetupModal onClose={() => setSetupOpen(false)} />}
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        className={styles.button}
        onClick={() => start()}
        disabled={disabledReason !== null}
        title={disabledReason === 'RUNNING' ? t('imports.disabled.running') : undefined}
        aria-busy={running}
      >
        {running || disabledReason === 'RUNNING' ? t('imports.running') : t('imports.button')}
      </button>
      {reviewLink}
      {dialogs}
    </>
  );
}
