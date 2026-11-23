'use client';

import Link from 'next/link';
import { useT } from '@/i18n/I18nProvider';
import styles from './forms.module.css';
import Modal from './Modal';

// "Importar automaticamente" (pedido do usuário): com o CSFloat ainda não ligado, explica em poucas linhas e leva às
// configurações, onde fica o passo a passo.
export default function ImportSetupModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Modal title={t('csfloatSetup.modalTitle')} onClose={onClose}>
      <div data-testid="import-setup-modal">
        <p>{t('csfloatSetup.modalBody')}</p>
        <p>{t('csfloatSetup.modalHint')}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose}>{t('csfloatSetup.later')}</button>
          <Link href="/settings/#csfloat" className={`${styles.button} ${styles.primary}`} onClick={onClose}>{t('csfloatSetup.configure')}</Link>
        </div>
      </div>
    </Modal>
  );
}
