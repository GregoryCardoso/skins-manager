'use client';

import { useT } from '@/i18n/I18nProvider';
import styles from './ImportButton.module.css';
import { useCsfloatImport } from './useCsfloatImport';

// Botão "Importar do CSFloat" (Inventário e Vendas, 9.2, D318). Desabilitado sem chave, sem loja ou durante uma importação.
export default function ImportButton() {
  const t = useT();
  const { running, disabledReason, start, dialogs } = useCsfloatImport();
  const hint =
    disabledReason === 'NO_KEY' ? t('imports.disabled.noKey')
      : disabledReason === 'NO_STORE' ? t('imports.disabled.noStore')
        : disabledReason === 'RUNNING' ? t('imports.disabled.running')
          : undefined;

  return (
    <>
      <button
        type="button"
        className={styles.button}
        onClick={() => start()}
        disabled={disabledReason !== null}
        title={hint}
        aria-busy={running}
      >
        {running || disabledReason === 'RUNNING' ? t('imports.running') : t('imports.button')}
      </button>
      {dialogs}
    </>
  );
}
