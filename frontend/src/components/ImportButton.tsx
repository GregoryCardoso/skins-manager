'use client';

import { useState } from 'react';
import { useT } from '@/i18n/I18nProvider';
import styles from './ImportButton.module.css';
import ImportSetupModal from './ImportSetupModal';
import { useCsfloatImport } from './useCsfloatImport';

// Botão "Importar do CSFloat" (Inventário, Vendas, Aportes e Saques; 9.2, D318). Com o CSFloat ainda não ligado (sem chave ou sem
// loja), vira "Importar automaticamente" e abre um modal simples que leva às configurações (pedido do usuário).
export default function ImportButton() {
  const t = useT();
  const { running, disabledReason, start, dialogs } = useCsfloatImport();
  const [setupOpen, setSetupOpen] = useState(false);
  const needsSetup = disabledReason === 'NO_KEY' || disabledReason === 'NO_STORE';

  if (needsSetup) {
    return (
      <>
        <button type="button" className={styles.button} onClick={() => setSetupOpen(true)}>{t('csfloatSetup.button')}</button>
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
      {dialogs}
    </>
  );
}
