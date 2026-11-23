'use client';

import { useT } from '@/i18n/I18nProvider';
import type { ComponentType } from 'react';
import CsfloatIntegrationCard from './CsfloatIntegrationCard';
import styles from './settings.module.css';

// Integrações com Adapter implementado (D317): só elas aparecem na seção.
// Uma nova integração entra aqui quando o seu Adapter existir.
export const IMPLEMENTED_INTEGRATIONS: ReadonlyArray<{ source: string; Card: ComponentType }> = [
  { source: 'CSFLOAT', Card: CsfloatIntegrationCard },
];

// Seção "Integrações" das configurações (9.1, D316): um card por loja integrada (hoje só o CSFloat).
export default function IntegrationsSettings() {
  const t = useT();
  return (
    <section aria-labelledby="settings-integrations-title">
      <h2 id="settings-integrations-title" className={styles.cardTitle}>{t('settings.integrations.title')}</h2>
      <p className={styles.muted}>{t('settings.integrations.description')}</p>
      {IMPLEMENTED_INTEGRATIONS.map(({ source, Card }) => (
        <Card key={source} />
      ))}
    </section>
  );
}
