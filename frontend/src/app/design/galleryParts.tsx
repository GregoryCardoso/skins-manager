'use client';

import { useState, type ReactNode } from 'react';
import styles from './design.module.css';
import { FRAME_WIDTHS, FX } from './galleryFixtures';

// Quadro redimensionável: exercita as container queries (resize: horizontal + botões 480/720/960).
export function Section({ title, children }: { title: string; children: ReactNode }) {
  const [width, setWidth] = useState<number | null>(null);
  return (
    <section className={styles.gSection}>
      <div className={styles.gSectionHead}>
        <h3 className={styles.gTitle}>{title}</h3>
        <span className={styles.gWidths}>
          <span className={styles.note}>{FX.width}</span>
          {FRAME_WIDTHS.map((w) => (
            <button key={w} type="button" className={styles.gWidthBtn} aria-pressed={width === w} onClick={() => setWidth(w)}>
              {w}
            </button>
          ))}
          <button type="button" className={styles.gWidthBtn} aria-pressed={width === null} onClick={() => setWidth(null)}>
            {FX.widthFree}
          </button>
        </span>
      </div>
      <div className={styles.gFrame} style={width ? { width: `${width}px` } : undefined}>
        {children}
      </div>
    </section>
  );
}

export function Row({ caption, children }: { caption?: string; children: ReactNode }) {
  return (
    <div className={styles.gRow}>
      {caption && <span className={styles.gCaption}>{caption}</span>}
      <div className={styles.gItems}>{children}</div>
    </div>
  );
}
