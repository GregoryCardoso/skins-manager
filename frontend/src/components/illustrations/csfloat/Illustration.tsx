import type { ReactNode } from 'react';
import styles from './Illustration.module.css';

// Moldura das ilustrações do guia do CSFloat (12.9): SVG inline, formas genéricas e só cores por token. Nada do site, da logo ou da
// marca do CSFloat (E-P4-Q9). `alt` já vem traduzido (role="img").
export default function Illustration({ alt, children }: { alt: string; children: ReactNode }) {
  return (
    <svg className={styles.svg} viewBox="0 0 160 100" role="img" aria-label={alt}>
      <rect x="1" y="1" width="158" height="98" rx="8" fill="var(--surface-2)" stroke="var(--line)" />
      {children}
    </svg>
  );
}
