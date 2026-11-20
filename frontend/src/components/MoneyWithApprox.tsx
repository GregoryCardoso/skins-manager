'use client';

import { useLanguage, useT } from '@/i18n/I18nProvider';
import { formatMoney } from '@/lib/format';
import type { Currency } from '@/types/api';
import styles from './MoneyWithApprox.module.css';

interface Props {
  // Valor na moeda nativa da operação.
  cents: number;
  currency: Currency;
  // Mesmo valor em USD, pela cotação gravada (oficial do relatório, 2.9).
  usdCents: number;
  // "≈ R$" pela cotação atual (só ilustrativo, 2.11); null sem cotação.
  approxBrlCents: number | null;
  // Nota da cotação gravada (ex.: "cotação da venda R$ 5,40"), quando o valor nativo é BRL.
  rateNote?: string | null;
  signed?: boolean;
  highlightNegative?: boolean;
}

// Regras de D125: nativo USD -> "≈ R$"; nativo BRL -> "= US$" com a marca da cotação gravada (não é aproximado).
export default function MoneyWithApprox({
  cents, currency, usdCents, approxBrlCents, rateNote = null, signed = false, highlightNegative = false,
}: Props) {
  const t = useT();
  const locale = useLanguage();
  const sign = (value: number, text: string) => (signed && value > 0 ? `+${text}` : text);
  const negative = highlightNegative && cents < 0;

  return (
    <div className={styles.wrap}>
      <span className={`${styles.main} ${negative ? styles.negative : ''}`}>
        {sign(cents, formatMoney(cents, currency, locale))}
      </span>
      {currency === 'BRL' ? (
        <span className={styles.side} title={rateNote ?? undefined}>
          {`= ${formatMoney(usdCents, 'USD', locale)}`}
          {rateNote ? ` · ${rateNote}` : ''}
        </span>
      ) : (
        approxBrlCents !== null && (
          <span className={styles.side}>{t('common.approx', { value: formatMoney(approxBrlCents, 'BRL', locale) })}</span>
        )
      )}
    </div>
  );
}
