'use client';

import type { CSSProperties } from 'react';
import { useLocale, useT, useTPlural } from '@/i18n/I18nProvider';
import { cutoffTimeline } from '@/lib/cutoffTimeline';
import { formatDateTime } from '@/lib/format';
import styles from './CutoffTimeline.module.css';

interface Props {
  // Data de corte atual (ISO) ou nula, quando ainda não existe.
  current: string | null;
  // Data nova (ISO): no modal de alterar, mostra o trecho que muda de lado.
  next?: string | null;
  // Quantos trades mudam de lado (da prévia que já existe); omitido = não mostra a contagem.
  moves?: number | null;
  now?: Date;
}

// Linha do tempo da data de corte (12.9): "antes: não importado", o marcador da data e "depois: importado". Com a data nova, mostra
// também o trecho entre as duas. É só desenho: a prévia do efeito vem do backend. Horizontal; vertical em contêiner compacto.
// Posição e extensão em % como variáveis CSS: a mesma marcação serve na horizontal e na vertical.
const pos = (at: number, size: number): CSSProperties => ({ '--at': at, '--size': size }) as CSSProperties;

export default function CutoffTimeline({ current, next = null, moves = null, now = new Date() }: Props) {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const geometry = cutoffTimeline(current, next, now);
  const hasNext = geometry.nextPct !== null;
  // Sem data atual (primeiro corte), o marcador é o da data escolhida.
  const marker = geometry.currentPct ?? geometry.nextPct;
  const sentence = geometry.move === 'EARLIER' ? t('imports.timeline.earlier') : geometry.move === 'LATER' ? t('imports.timeline.later') : null;

  return (
    <figure className={styles.root} aria-label={t('imports.timeline.label')} data-testid="cutoff-timeline" data-move={geometry.move}>
      <div className={styles.track}>
        <div className={styles.before} style={pos(marker ?? 0, 0)} />
        <div className={styles.after} style={pos(marker ?? 0, 0)} />
        {geometry.segment && (
          <div
            className={styles.segment}
            data-direction={geometry.move}
            style={pos(geometry.segment.fromPct, geometry.segment.toPct - geometry.segment.fromPct)}
          />
        )}
        {geometry.currentPct !== null && <span className={`${styles.marker} ${styles.markerCurrent}`} style={pos(geometry.currentPct, 0)} />}
        {hasNext && geometry.nextPct !== null && <span className={`${styles.marker} ${styles.markerNew}`} style={pos(geometry.nextPct, 0)} />}
      </div>
      <div className={styles.labels}>
        <span className={styles.labelBefore}>{t('imports.timeline.before')}</span>
        <span className={styles.labelAfter}>{t('imports.timeline.after')}</span>
      </div>
      <ul className={styles.dates}>
        {current && (
          <li>
            <span className={`${styles.dot} ${styles.dotCurrent}`} aria-hidden="true" />
            {t('imports.timeline.current', { date: formatDateTime(current, locale) })}
          </li>
        )}
        {next && (
          <li>
            <span className={`${styles.dot} ${styles.dotNew}`} aria-hidden="true" />
            {t('imports.timeline.new', { date: formatDateTime(next, locale) })}
          </li>
        )}
      </ul>
      {sentence && (
        <figcaption className={styles.caption}>
          {sentence}
          {moves !== null && moves > 0 && <> {tPlural('imports.timeline.moves', moves)}</>}
        </figcaption>
      )}
    </figure>
  );
}
