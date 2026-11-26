import type { ReactNode } from 'react';
import styles from './Equation.module.css';

export type EquationOperator = '+' | '−' | '=';

export interface EquationRow {
  // Operador à esquerda; é texto de verdade (lido pelo leitor de tela), não decoração.
  op?: EquationOperator;
  label: string;
  // Linha menor abaixo do rótulo.
  note?: ReactNode;
  // Normalmente um <Money>.
  value: ReactNode;
  // `sub` = detalhe recuado de uma linha; `result` = o resultado (traço em cima, valor grande).
  variant?: 'normal' | 'sub' | 'result';
}

export interface EquationProps {
  rows: EquationRow[];
  className?: string;
}

// A "equação do lucro" do protótipo: só layout (o conteúdo e os números são da tela). <dl> com um <div> por linha.
export default function Equation({ rows, className }: EquationProps) {
  return (
    <dl className={`${styles.equation} ${className ?? ''}`}>
      {rows.map((row, index) => (
        <div key={index} className={`${styles.row} ${styles[row.variant ?? 'normal']}`}>
          <dt className={styles.term}>
            <span className={styles.op}>{row.op ?? ''}</span>
            <span className={styles.label}>
              {row.label}
              {row.note && <small className={styles.note}>{row.note}</small>}
            </span>
          </dt>
          <dd className={styles.value}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
