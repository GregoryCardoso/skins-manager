'use client';

import Link from 'next/link';
import { useT } from '@/i18n/I18nProvider';
import styles from './imports/importModals.module.css';
import Button from './ui/Button';
import Dialog from './ui/Dialog';

// "Importar automaticamente" (pedido do usuário): com o CSFloat ainda não ligado, explica em poucas linhas e leva às
// configurações, onde fica o passo a passo.
export default function ImportSetupModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Dialog
      title={t('csfloatSetup.modalTitle')}
      size="sm"
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>{t('csfloatSetup.later')}</Button>
          <Link prefetch={false} href="/settings/#csfloat" className={styles.linkButton} onClick={onClose}>{t('csfloatSetup.configure')}</Link>
        </>
      )}
    >
      <div className={styles.stack} data-testid="import-setup-modal">
        <p>{t('csfloatSetup.modalBody')}</p>
        <p className={styles.help}>{t('csfloatSetup.modalHint')}</p>
      </div>
    </Dialog>
  );
}
