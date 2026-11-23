'use client';

import { useState } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { offlineTasks, useStartupStatus } from '@/lib/startupStatus';
import Modal from './Modal';
import styles from './forms.module.css';

// "Sem conexão com a internet" ao abrir o app (pedido do usuário): avisa, num só modal, o que não foi atualizado (cotação e/ou
// importação do CSFloat). O app continua com os últimos dados; nada foi gravado.
export default function StartupOfflineModal() {
  const t = useT();
  const status = useStartupStatus();
  const [dismissed, setDismissed] = useState<string>('');
  const tasks = offlineTasks(status);
  const key = tasks.join(',');
  if (tasks.length === 0 || key === dismissed) return null;
  return (
    <Modal title={t('startup.offline.title')} onClose={() => setDismissed(key)}>
      <div data-testid="startup-offline">
        <p>{t('startup.offline.intro')}</p>
        <ul>
          {tasks.map((task) => <li key={task}>{t(task === 'fx' ? 'startup.offline.fx' : 'startup.offline.csfloat')}</li>)}
        </ul>
        <p>{t('startup.offline.hint')}</p>
        <div className={styles.actions}>
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => setDismissed(key)}>{t('startup.offline.ok')}</button>
        </div>
      </div>
    </Modal>
  );
}
