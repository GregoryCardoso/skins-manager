'use client';

import { useSyncExternalStore } from 'react';
import Icon from '@/components/ui/Icon';
import Tooltip from '@/components/ui/Tooltip';
import { useT } from '@/i18n/I18nProvider';
import {
  badgePhase,
  getServerUpdateUiSnapshot,
  getUpdateUiSnapshot,
  requestUpdateReopen,
  subscribeUpdateUi,
} from '@/lib/updateUiStore';
import styles from './UpdateBadge.module.css';

export interface UpdateBadgeProps {
  // Menu recolhido: só o ícone; o texto fica para o leitor de tela e o Tooltip mostra o nome.
  compact: boolean;
}

// Selo "Atualização disponível" do menu (D370, 12.10 parte 3). Só existe no desktop (o DesktopUpdateHost é quem publica o estado) e só
// nas fases available, portable-available, downloading (com a porcentagem) e ready. Clicar reabre o modal, se estiver escondido.
export default function UpdateBadge({ compact }: UpdateBadgeProps) {
  const t = useT();
  const { state } = useSyncExternalStore(subscribeUpdateUi, getUpdateUiSnapshot, getServerUpdateUiSnapshot);
  if (!badgePhase(state)) return null;

  let label: string;
  if (state.phase === 'downloading') {
    label = state.percent === null ? t('desktopUpdate.downloadingTitle') : t('desktopUpdate.badgeDownloading', { percent: state.percent });
  } else if (state.phase === 'ready') {
    label = t('desktopUpdate.readyTitle');
  } else {
    label = t('desktopUpdate.badge');
  }

  const button = (
    <button type="button" className={styles.badge} data-phase={state.phase} onClick={requestUpdateReopen}>
      <span className={styles.icon}>
        <Icon name={state.phase === 'ready' ? 'refresh' : 'imports'} size={16} />
        <span className={styles.dot} aria-hidden="true" />
      </span>
      <span className={styles.label}>{label}</span>
    </button>
  );
  return compact ? (
    <Tooltip side="right" content={label}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}
