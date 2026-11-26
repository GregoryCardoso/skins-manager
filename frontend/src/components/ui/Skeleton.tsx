import type { CSSProperties } from 'react';
import styles from './Skeleton.module.css';

export interface SkeletonProps {
  // Qualquer medida CSS ("12rem", "60%"). Padrão: a largura toda.
  width?: string;
  height?: string;
  // Várias linhas de texto (a última é mais curta).
  lines?: number;
  radius?: 'sm' | 'md' | 'pill';
  className?: string;
}

// Placeholder de carregamento. Sempre aria-hidden: quem o usa marca o contêiner com aria-busy (e/ou mostra um Spinner com texto).
// O brilho para com prefers-reduced-motion.
export default function Skeleton({ width, height, lines = 1, radius = 'sm', className }: SkeletonProps) {
  const count = Math.max(1, Math.floor(lines));
  const bars = Array.from({ length: count }, (_, index) => {
    const style: CSSProperties = { width: count > 1 && index === count - 1 ? '60%' : width, height };
    return <span key={index} className={`${styles.bar} ${styles[radius]}`} style={style} />;
  });
  return (
    <span className={`${count > 1 ? styles.lines : styles.single} ${className ?? ''}`} aria-hidden="true">
      {bars}
    </span>
  );
}
