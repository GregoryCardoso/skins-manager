'use client';

import { useRef, type ReactNode } from 'react';
import { useT } from '@/i18n/I18nProvider';
import type { UpdateAction, UpdatePhase, UpdateState } from '@/lib/desktop';
import { selectReleaseNotes } from '@/lib/releaseNotes';
import ReleaseNotes from './ReleaseNotes';
import Badge from './ui/Badge';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import Disclosure from './ui/Disclosure';
import styles from './UpdateModal.module.css';

// O que o X/Esc faz em cada fase (D190, V102-Q2; inalterado na 12.10, P6):
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

// Janela de atualização (D370, 12.10 parte 3) sobre o Dialog da 12.3. Nada é baixado nem instalado sem o usuário escolher:
// em cada fase há um caminho principal (à direita, com o foco inicial) e um secundário.
export default function UpdateModal({ state, language, busy, onAction, onHide }: Props) {
  const t = useT();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const { phase } = state;
  const version = state.version ?? '';
  const current = state.currentVersion ?? '';
  const locked = busy || phase === 'installing';

  const onClose = () => {
    const choice = closeActionFor(phase);
    if (choice === 'hide') onHide();
    else if (choice !== null) onAction(choice);
  };

  const action = (id: UpdateAction, label: string, primary = false) => (
    <Button key={id} ref={primary ? primaryRef : undefined} variant={primary ? 'primary' : 'secondary'} onClick={() => onAction(id)} disabled={locked}>
      {label}
    </Button>
  );

  const versionChange =
    version === '' ? null : (
      <Badge tone="info" className={styles.versionBadge}>
        {current === '' ? version : t('desktopUpdate.versionChange', { current, version })}
      </Badge>
    );

  const notes = selectReleaseNotes(state.notes, language);
  const notesBox: ReactNode = (
    <Disclosure label={t('desktopUpdate.notes')} defaultOpen className={styles.notesBox}>
      <div className={styles.notesScroll}>
        {notes.trim() === '' ? <p className={styles.muted}>{t('desktopUpdate.notesEmpty')}</p> : <ReleaseNotes markdown={notes} />}
      </div>
    </Disclosure>
  );

  let title = '';
  let body: ReactNode = null;
  let footer: ReactNode = null;

  if (phase === 'available' || phase === 'portable-available') {
    const portable = phase === 'portable-available';
    title = t('desktopUpdate.availableTitle');
    body = (
      <div className={styles.content}>
        <div className={styles.versionRow}>
          <p className={styles.message}>{t('desktopUpdate.availableMessage', { version, current })}</p>
          {versionChange}
        </div>
        <p className={styles.muted}>{t(portable ? 'desktopUpdate.portableDetail' : 'desktopUpdate.availableDetail')}</p>
        {notesBox}
      </div>
    );
    footer = portable ? (
      <>
        {action('dismiss', t('desktopUpdate.later'))}
        {action('openDownloadPage', t('desktopUpdate.openDownloadPage'), true)}
      </>
    ) : (
      <>
        {action('later', t('desktopUpdate.later'))}
        {action('download', t('desktopUpdate.download'), true)}
      </>
    );
  } else if (phase === 'downloading') {
    // Valor fora de 0 a 100 (ou NaN) não pode estourar a barra nem o aria-valuenow: limita; NaN vira indeterminado.
    const percent = state.percent === null || Number.isNaN(state.percent) ? null : Math.min(100, Math.max(0, state.percent));
    title = t('desktopUpdate.downloadingTitle');
    body = (
      <div className={styles.content}>
        <p className={styles.message}>{t('desktopUpdate.downloadingMessage', { version })}</p>
        <div className={styles.progressRow}>
          <div
            className={`${styles.progress} ${percent === null ? styles.indeterminate : ''}`}
            role="progressbar"
            aria-label={t('desktopUpdate.downloadingTitle')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
          >
            <span className={styles.progressFill} style={percent === null ? undefined : { width: `${percent}%` }} />
          </div>
          <span className={styles.percent}>{percent === null ? '' : `${percent}%`}</span>
        </div>
        <p className={styles.muted}>{t('desktopUpdate.downloadingHint')}</p>
      </div>
    );
    footer = (
      <Button ref={primaryRef} variant="primary" onClick={onHide}>
        {t('desktopUpdate.hide')}
      </Button>
    );
  } else if (phase === 'ready') {
    title = t('desktopUpdate.readyTitle');
    body = (
      <div className={styles.content}>
        <div className={styles.versionRow}>
          <p className={styles.message}>{t('desktopUpdate.readyMessage', { version })}</p>
          {versionChange}
        </div>
        <p className={styles.muted}>{t('desktopUpdate.readyDetail')}</p>
      </div>
    );
    footer = (
      <>
        {action('installOnQuit', t('desktopUpdate.installOnQuit'))}
        {action('restart', t('desktopUpdate.restartNow'), true)}
      </>
    );
  } else if (phase === 'installing') {
    title = t('desktopUpdate.installingTitle');
    body = (
      <p className={styles.message} role="status">
        {t('desktopUpdate.installing')}
      </p>
    );
  } else if (phase === 'error') {
    const kind = state.error?.kind === 'install' ? 'install' : 'download';
    title = t('desktopUpdate.errorTitle');
    body = (
      <div className={styles.content}>
        <Banner tone="danger">{t(kind === 'install' ? 'desktopUpdate.errorInstall' : 'desktopUpdate.errorDownload')}</Banner>
        {state.error && state.error.detail !== '' && (
          <Disclosure label={t('desktopUpdate.errorDetail')}>
            <pre className={styles.detail}>{state.error.detail}</pre>
          </Disclosure>
        )}
      </div>
    );
    footer = action('dismiss', t('common.close'), true);
  } else {
    return null;
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      busy={locked}
      size={phase === 'available' || phase === 'portable-available' ? 'lg' : 'md'}
      footer={footer}
      onOpenAutoFocus={(event) => {
        if (primaryRef.current) {
          event.preventDefault();
          primaryRef.current.focus();
        }
      }}
    >
      {body}
    </Dialog>
  );
}
