'use client';

import type { ReactNode } from 'react';
import { useT } from '@/i18n/I18nProvider';
import type { UpdateAction, UpdatePhase, UpdateState } from '@/lib/desktop';
import { selectReleaseNotes } from '@/lib/releaseNotes';
import forms from './forms.module.css';
import Modal from './Modal';
import ReleaseNotes from './ReleaseNotes';
import styles from './UpdateModal.module.css';

// O que o X/Esc faz em cada fase (D190, V102-Q2):
//  - available, portable-available, error: responde "agora não" / "fechar" ao processo principal;
//  - ready e downloading: só esconde o modal (sem escolher nada e sem IPC). Em ready, fechar o app sem escolher não
//    instala: a atualização é oferecida de novo na próxima abertura;
//  - installing e idle: não fecha.
export type CloseChoice = UpdateAction | 'hide' | null;

export function closeActionFor(phase: UpdatePhase): CloseChoice {
  switch (phase) {
    case 'available':
      return 'later';
    case 'portable-available':
    case 'error':
      return 'dismiss';
    case 'ready':
    case 'downloading':
      return 'hide';
    default:
      return null;
  }
}

// Modal escondido localmente (X/Esc em ready ou downloading). Em downloading vale enquanto a fase for a mesma (o
// progresso muda o seq o tempo todo); em ready vale até o seq mudar (a verificação manual reabre com um seq novo).
export interface HiddenMarker {
  phase: UpdatePhase;
  seq: number;
}

export function isModalHidden(hidden: HiddenMarker | null, state: UpdateState): boolean {
  if (!hidden || hidden.phase !== state.phase) return false;
  return state.phase === 'downloading' ? true : hidden.seq === state.seq;
}

interface Props {
  state: UpdateState;
  language: string;
  // Aguardando a resposta do processo principal: os botões ficam inativos (evita clique duplo).
  busy: boolean;
  onAction: (action: UpdateAction) => void;
  onHide: () => void;
}

export default function UpdateModal({ state, language, busy, onAction, onHide }: Props) {
  const t = useT();
  const { phase } = state;
  const version = state.version ?? '';
  const current = state.currentVersion ?? '';
  const locked = busy || phase === 'installing';

  const onClose = () => {
    const choice = closeActionFor(phase);
    if (choice === 'hide') onHide();
    else if (choice !== null) onAction(choice);
  };

  const button = (action: UpdateAction, label: string, primary = false) => (
    <button
      key={action}
      type="button"
      className={primary ? `${forms.button} ${forms.primary}` : forms.button}
      onClick={() => onAction(action)}
      disabled={locked}
    >
      {label}
    </button>
  );

  const notes = selectReleaseNotes(state.notes, language);
  const notesBox: ReactNode = (
    <section className={styles.notesBox} aria-label={t('desktopUpdate.notes')}>
      <h3 className={styles.notesTitle}>{t('desktopUpdate.notes')}</h3>
      <div className={styles.notesScroll}>
        {notes.trim() === '' ? <p className={forms.muted}>{t('desktopUpdate.notesEmpty')}</p> : <ReleaseNotes markdown={notes} />}
      </div>
    </section>
  );

  let title = '';
  let body: ReactNode = null;
  let actions: ReactNode = null;

  if (phase === 'available' || phase === 'portable-available') {
    const portable = phase === 'portable-available';
    title = t('desktopUpdate.availableTitle');
    body = (
      <>
        <p className={styles.message}>{t('desktopUpdate.availableMessage', { version, current })}</p>
        <p className={forms.muted}>{t(portable ? 'desktopUpdate.portableDetail' : 'desktopUpdate.availableDetail')}</p>
        {notesBox}
      </>
    );
    actions = portable ? (
      <>
        {button('dismiss', t('desktopUpdate.later'))}
        {button('openDownloadPage', t('desktopUpdate.openDownloadPage'), true)}
      </>
    ) : (
      <>
        {button('later', t('desktopUpdate.later'))}
        {button('download', t('desktopUpdate.download'), true)}
      </>
    );
  } else if (phase === 'downloading') {
    const percent = state.percent;
    title = t('desktopUpdate.downloadingTitle');
    body = (
      <>
        <p className={styles.message}>{t('desktopUpdate.downloadingMessage', { version })}</p>
        <div className={styles.progressRow}>
          <progress
            className={styles.progress}
            max={100}
            value={percent ?? undefined}
            aria-label={t('desktopUpdate.downloadingTitle')}
          />
          <span className={styles.percent}>{percent === null ? '' : `${percent}%`}</span>
        </div>
        <p className={forms.muted}>{t('desktopUpdate.downloadingHint')}</p>
      </>
    );
    actions = (
      <button type="button" className={forms.button} onClick={onHide}>
        {t('desktopUpdate.hide')}
      </button>
    );
  } else if (phase === 'ready') {
    title = t('desktopUpdate.readyTitle');
    body = (
      <>
        <p className={styles.message}>{t('desktopUpdate.readyMessage', { version })}</p>
        <p className={forms.muted}>{t('desktopUpdate.readyDetail')}</p>
      </>
    );
    actions = (
      <>
        {button('installOnQuit', t('desktopUpdate.installOnQuit'))}
        {button('restart', t('desktopUpdate.restartNow'), true)}
      </>
    );
  } else if (phase === 'installing') {
    title = t('desktopUpdate.installingTitle');
    body = <p className={styles.message} role="status">{t('desktopUpdate.installing')}</p>;
  } else if (phase === 'error') {
    const kind = state.error?.kind === 'install' ? 'install' : 'download';
    title = t('desktopUpdate.errorTitle');
    body = (
      <>
        <div className={forms.topError} role="alert">
          {t(kind === 'install' ? 'desktopUpdate.errorInstall' : 'desktopUpdate.errorDownload')}
        </div>
        {state.error && state.error.detail !== '' && (
          <details className={forms.details}>
            <summary>{t('desktopUpdate.errorDetail')}</summary>
            <pre className={styles.detail}>{state.error.detail}</pre>
          </details>
        )}
      </>
    );
    actions = button('dismiss', t('common.close'), true);
  } else {
    return null;
  }

  return (
    <Modal title={title} onClose={onClose} busy={locked} wide={phase === 'available' || phase === 'portable-available'}>
      <div className={styles.content}>
        {body}
        {actions && <div className={forms.actions}>{actions}</div>}
      </div>
    </Modal>
  );
}
