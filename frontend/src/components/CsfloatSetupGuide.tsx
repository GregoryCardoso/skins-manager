'use client';

import type { ComponentType } from 'react';
import { useT } from '@/i18n/I18nProvider';
import Banner from './ui/Banner';
import Icon from './ui/Icon';
import Step1BrowserWindow from './illustrations/csfloat/Step1BrowserWindow';
import Step2ProfileMenu from './illustrations/csfloat/Step2ProfileMenu';
import Step3Key from './illustrations/csfloat/Step3Key';
import Step4CopyPaste from './illustrations/csfloat/Step4CopyPaste';
import Step5Shield from './illustrations/csfloat/Step5Shield';
import styles from './CsfloatSetupGuide.module.css';

// Endereço fixo do perfil no CSFloat (o mesmo do backend, CSFLOAT_HELP_URL). Só https: o desktop abre no navegador padrão.
export const CSFLOAT_PROFILE_URL = 'https://csfloat.com/profile';

const STEPS: readonly { key: 'step1' | 'step2' | 'step3' | 'step4' | 'step5'; Illustration: ComponentType<{ alt: string }> }[] = [
  { key: 'step1', Illustration: Step1BrowserWindow },
  { key: 'step2', Illustration: Step2ProfileMenu },
  { key: 'step3', Illustration: Step3Key },
  { key: 'step4', Illustration: Step4CopyPaste },
  { key: 'step5', Illustration: Step5Shield },
];

// Passo a passo para ligar o CSFloat (12.9): 5 passos com ilustração própria (formas genéricas, sem prints, logo ou marca do CSFloat).
// O botão "Abrir o CSFloat" fica no passo 1. Aberto no card enquanto não há chave salva; com chave, fica num Disclosure.
export default function CsfloatSetupGuide() {
  const t = useT();
  return (
    <div className={styles.guide} data-testid="csfloat-setup-guide">
      <p className={styles.title}>{t('csfloatSetup.title')}</p>
      <ol className={styles.steps}>
        {STEPS.map(({ key, Illustration }) => (
          <li key={key} className={styles.step}>
            <Illustration alt={t(`csfloatSetup.illustrationAlt.${key}`)} />
            <div className={styles.text}>
              <p className={styles.stepText}>{t(`csfloatSetup.${key}`)}</p>
              {key === 'step1' && (
                <a className={styles.open} href={CSFLOAT_PROFILE_URL} target="_blank" rel="noopener noreferrer">
                  <span>{t('csfloatSetup.open')}</span>
                  <Icon name="externalLink" size={14} />
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
      <Banner tone="warning" announce={false}>{t('csfloatSetup.safety')}</Banner>
    </div>
  );
}
