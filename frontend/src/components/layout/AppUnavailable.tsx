'use client';

import { useEffect } from 'react';
import Button from '@/components/ui/Button';
import Icon from '@/components/ui/Icon';
import PageHeader from '@/components/ui/PageHeader';
import { useLocale, useT } from '@/i18n/I18nProvider';
import { formatDateTime } from '@/lib/format';
import styles from './AppUnavailable.module.css';

const TITLE_ID = 'app-unavailable-title';

export interface AppUnavailableProps {
  // Instante (ms) da última verificação; null = nenhuma.
  lastCheckedAt: number | null;
  checking: boolean;
  onRecheck: () => void;
}

// Tela única "O app não está respondendo" (D370, 12.4): no lugar do conteúdo, com o menu e as preferências ao lado. Mostra os passos
// para reabrir o app, a hora da última verificação e o botão "Verificar de novo". O foco vai para o título quando ela aparece.
export default function AppUnavailable({ lastCheckedAt, checking, onRecheck }: AppUnavailableProps) {
  const t = useT();
  const locale = useLocale();

  useEffect(() => {
    document.getElementById(TITLE_ID)?.focus();
  }, []);

  return (
    <div className={styles.root} role="alert" data-testid="app-unavailable">
      <span className={styles.icon}>
        <Icon name="serverOff" size={32} />
      </span>
      <PageHeader title={t('unavailable.title')} headingId={TITLE_ID} />
      <p className={styles.intro}>{t('unavailable.intro')}</p>
      <ol className={styles.steps}>
        <li>{t('unavailable.steps.reopen')}</li>
        <li>{t('unavailable.steps.bat')}</li>
        <li>{t('unavailable.steps.restart')}</li>
      </ol>
      <div className={styles.actions}>
        <Button icon="refresh" loading={checking} onClick={onRecheck}>
          {checking ? t('status.checking') : t('status.recheck')}
        </Button>
        {lastCheckedAt !== null && (
          <span className={styles.last}>{t('unavailable.lastCheck', { time: formatDateTime(new Date(lastCheckedAt).toISOString(), locale) })}</span>
        )}
      </div>
    </div>
  );
}
