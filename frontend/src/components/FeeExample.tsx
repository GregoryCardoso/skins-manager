'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { feeExampleInput, feeExampleKey } from '@/lib/feeExample';
import { formatMoney } from '@/lib/format';
import { formatCentsInput } from '@/lib/numberInput';
import type { StoreFormState } from '@/lib/storeForm';
import { queryKeys } from '@/lib/queryKeys';
import { previewStoreFee } from '@/services/api';
import NumberField from './ui/NumberField';
import styles from './FeeExample.module.css';

export const FEE_EXAMPLE_DEBOUNCE_MS = 300;

// Valor que só "assenta" depois de `delay` ms sem mudar (o exemplo não chama a API a cada tecla).
function useSettled<T>(value: T, key: string, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delay]);
  return settled;
}

// Exemplo ao vivo da taxa (12.8): "Numa venda de US$ 10, a taxa é US$ 0,20 e você recebe US$ 9,80". A conta é do backend
// (`GET /stores/fee-preview`, as mesmas Strategies da venda); aqui só se monta o pedido, com debounce, e se mostra a frase. Um erro do
// exemplo aparece discreto, no próprio exemplo, e nunca bloqueia o salvar. Troque a `key` quando a moeda mudar (o preço volta ao padrão).
export default function FeeExample({ state }: { state: StoreFormState }) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const [priceText, setPriceText] = useState('');
  const [touched, setTouched] = useState(false);

  const input = feeExampleInput(state, touched ? priceText : '', locale);
  const query = input.status === 'ready' ? input.query : null;
  const queryKey = query ? JSON.stringify(feeExampleKey(query)) : input.status;
  const settled = useSettled(query, queryKey, FEE_EXAMPLE_DEBOUNCE_MS);
  // Só pede quando o que está na tela já assentou (o pedido antigo é cancelado pelo `signal`).
  const settledKey = settled ? JSON.stringify(feeExampleKey(settled)) : null;
  const preview = useQuery({
    queryKey: queryKeys.stores.feePreview(feeExampleKey(settled)),
    queryFn: ({ signal }) => previewStoreFee(settled!, signal),
    enabled: settled !== null && settledKey === queryKey,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  const shownPrice = touched ? priceText : preview.data ? formatCentsInput(preview.data.priceCents, locale, state.currency) : '';
  const data = query !== null ? preview.data : undefined;

  let body;
  if (input.status === 'notConfigured') {
    body = <p className={styles.muted}>{t('storeForm.example.notConfigured')}</p>;
  } else if (preview.isError && query !== null) {
    body = <p className={styles.muted} role="status">{t('storeForm.example.error', { reason: errorMessageFor(preview.error, tLoose, locale) })}</p>;
  } else if (data) {
    const params = {
      price: formatMoney(data.priceCents, data.currency, locale),
      fee: formatMoney(data.feeCents, data.currency, locale),
      net: formatMoney(data.netCents, data.currency, locale),
    };
    body = <p className={styles.sentence} aria-live="polite">{t(data.saleFeeType === 'ADDED' ? 'storeForm.example.added' : 'storeForm.example.deducted', params)}</p>;
  } else {
    body = <p className={styles.muted}>{input.status === 'incomplete' ? t('storeForm.example.incomplete') : t('common.loading')}</p>;
  }

  return (
    <div className={styles.box} data-testid="fee-example">
      <h3 className={styles.title}>{t('storeForm.example.title')}</h3>
      {input.status !== 'notConfigured' && (
        <NumberField
          kind="money"
          currency={state.currency}
          label={t('storeForm.example.priceLabel', { currency: state.currency })}
          value={shownPrice}
          showFormatHint={false}
          onValueChange={(text) => {
            setTouched(true);
            setPriceText(text);
          }}
        />
      )}
      {body}
    </div>
  );
}
