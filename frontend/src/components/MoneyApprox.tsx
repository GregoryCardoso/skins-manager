'use client';

import { useLocale, useT } from '@/i18n/I18nProvider';
import { moneyTexts, type MoneyInput } from '@/lib/baseMoney';
import styles from './MoneyApprox.module.css';

// Hook: o mesmo valor em uma linha só ("≈ US$ 147,23 (≈ R$ 799,77)" ou "indisponível"), para frases e rodapés.
export function useMoneyLine(): (input: MoneyInput) => string {
  const t = useT();
  const locale = useLocale();
  return (input) => {
    const texts = moneyTexts(input, locale);
    if (texts.main === null) return t('profit.summary.unavailable');
    const main = texts.mainEstimated ? t('common.approx', { value: texts.main }) : texts.main;
    return texts.approx === null ? main : `${main} (${t('common.approx', { value: texts.approx })})`;
  };
}

// Valor principal com o "≈ R$" (ou "≈ US$") discreto abaixo. Nada é calculado aqui.
export default function MoneyApprox(input: MoneyInput & { className?: string }) {
  const t = useT();
  const locale = useLocale();
  const texts = moneyTexts(input, locale);
  const main = texts.main === null
    ? <span className={styles.unavailable} title={t('profit.summary.unavailableHint')}>{t('profit.summary.unavailable')}</span>
    : <span>{texts.mainEstimated ? t('common.approx', { value: texts.main }) : texts.main}</span>;
  return (
    <span className={`${styles.wrap} ${input.className ?? ''}`}>
      {main}
      {texts.approx !== null && <small className={styles.approx}>{t('common.approx', { value: texts.approx })}</small>}
    </span>
  );
}
