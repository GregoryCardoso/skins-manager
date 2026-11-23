'use client';

import { useT } from '@/i18n/I18nProvider';
import styles from './CsfloatSetupGuide.module.css';

// Endereço fixo do perfil no CSFloat (o mesmo do backend, CSFLOAT_HELP_URL). Só https: o desktop abre no navegador padrão.
export const CSFLOAT_PROFILE_URL = 'https://csfloat.com/profile';

// Passo a passo para ligar o CSFloat (pedido do usuário): fica aberto no card das configurações enquanto não há chave salva.
export default function CsfloatSetupGuide() {
  const t = useT();
  return (
    <div className={styles.guide} data-testid="csfloat-setup-guide">
      <p className={styles.title}>{t('csfloatSetup.title')}</p>
      <ol className={styles.steps}>
        <li>{t('csfloatSetup.step1')}</li>
        <li>{t('csfloatSetup.step2')}</li>
        <li>{t('csfloatSetup.step3')}</li>
        <li>{t('csfloatSetup.step4')}</li>
        <li>{t('csfloatSetup.step5')}</li>
      </ol>
      <p>
        <a className={styles.open} href={CSFLOAT_PROFILE_URL} target="_blank" rel="noopener noreferrer">{t('csfloatSetup.open')}</a>
      </p>
      <p className={styles.safety}>{t('csfloatSetup.safety')}</p>
    </div>
  );
}
