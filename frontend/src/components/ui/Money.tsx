'use client';

import { useLocale, useT } from '@/i18n/I18nProvider';
import { moneyTexts, type MoneyInput } from '@/lib/baseMoney';
import Badge from './Badge';
import HelpTip from './HelpTip';
import styles from './Money.module.css';

export type MoneySize = 'sm' | 'md' | 'lg' | 'xl';

export type MoneyProps = MoneyInput & {
  size?: MoneySize;
  // `stack`: o "≈" fica embaixo do valor; `inline`: ao lado (quebra para baixo se faltar espaço).
  layout?: 'stack' | 'inline';
  // Alinhamento do bloco (padrão start; end para colunas de números à direita).
  align?: 'start' | 'end';
  // Cor pelo sinal (lucro/prejuízo) E o sinal no texto: "+" posto aqui, "−" vem do Intl. Zero fica neutro.
  signed?: boolean;
  // Texto pronto do chamador (a partir de `isStale` da API), por exemplo "Cotação de 3 dias atrás". Mostra um relógio ao lado do "≈".
  staleRateNote?: string;
  // Com `estimated`, mostra também a etiqueta "estimado" (padrão: sim). Em listas cheias de "≈", o chamador pode desligar.
  estimatedBadge?: boolean;
  className?: string;
};

// Valor em dinheiro: o principal com tabular-nums e o "≈" menor e discreto (D370 Q6). Sucessor do MoneyApprox; usa as mesmas funções de
// formatação (`moneyTexts`/`formatMoney`: as moedas sem casas decimais já saem sem decimais). Nada é calculado nem convertido aqui.
export default function Money({ size = 'md', layout = 'stack', align = 'start', signed = false, staleRateNote, estimatedBadge = true, className, ...input }: MoneyProps) {
  const t = useT();
  const locale = useLocale();
  const texts = moneyTexts(input, locale);

  if (texts.main === null) {
    return (
      <span className={`${styles.wrap} ${styles[size]} ${styles[layout]} ${align === 'end' ? styles.alignEnd : ''} ${className ?? ''}`}>
        <span className={styles.unavailable}>
          {t('profit.summary.unavailable')}
          <HelpTip topic={t('profit.summary.unavailable')}>{t('profit.summary.unavailableHint')}</HelpTip>
        </span>
      </span>
    );
  }

  const cents = input.cents ?? 0;
  const tone = signed ? (cents > 0 ? styles.profit : cents < 0 ? styles.loss : '') : '';
  const signedMain = signed && cents > 0 ? `+${texts.main}` : texts.main;
  const main = texts.mainEstimated ? t('common.approx', { value: signedMain }) : signedMain;

  return (
    <span className={`${styles.wrap} ${styles[size]} ${styles[layout]} ${align === 'end' ? styles.alignEnd : ''} ${className ?? ''}`}>
      <span className={styles.line}>
        <span className={`${styles.main} ${tone}`}>{main}</span>
        {texts.mainEstimated && estimatedBadge && <Badge tone="estimated">{t('ui.money.estimated')}</Badge>}
      </span>
      {(texts.approx !== null || staleRateNote) && (
        <span className={styles.approxLine}>
          {texts.approx !== null && <span className={styles.approx}>{t('common.approx', { value: texts.approx })}</span>}
          {staleRateNote && (
            <HelpTip topic={t('ui.money.staleRate')} icon="clock" side="bottom">
              {staleRateNote}
            </HelpTip>
          )}
        </span>
      )}
    </span>
  );
}
