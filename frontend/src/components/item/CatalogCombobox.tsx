'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDate } from '@/lib/format';
import { catalogDisplayName } from '@/lib/itemName';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, MIN_CATALOG_QUERY_LENGTH, refreshCatalog, searchCatalog } from '@/services/api';
import type { CatalogItem, Category } from '@/types/api';
import Combobox, { type ComboboxOption } from '../ui/Combobox';
import Button from '../ui/Button';
import Select from '../ui/Select';
import ItemImage from '../ItemImage';
import styles from './item.module.css';

const DEBOUNCE_MS = 250;
const RESULT_LIMIT = 20;

export const CATALOG_FILTER_CATEGORIES: Category[] = [
  'SKIN', 'FACA', 'LUVA', 'CAIXA', 'CAPSULA', 'STICKER', 'PINGENTE', 'PERSONAGEM', 'PATCH', 'PASSE_BATALHA',
];

interface Props {
  label: string;
  // Filtro fixo de categoria (vincular item legado, componentes). Sem ele, o usuário pode filtrar pela categoria.
  fixedCategory?: Category;
  error?: string | null;
  autoFocus?: boolean;
  // Esconde "Não achou? Atualizar o catálogo" (seletores de componentes, que são secundários).
  hideRefresh?: boolean;
  // Nome do campo para o resumo de erros (vira `data-field`).
  name?: string;
  onSelect: (item: CatalogItem) => void;
}

// Busca no catálogo local sobre o Combobox (D116, 12.6a): a busca é do backend (`filter="none"`), com pausa de 250 ms, cancelamento
// da busca anterior (uma resposta velha nunca sobrescreve a nova) e imagem de 32 px por opção. Não guarda o item escolhido: quem
// chama troca este campo pelo item escolhido.
export default function CatalogCombobox({ label, fixedCategory, error, autoFocus = false, hideRefresh = false, name, onSelect }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const [text, setText] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<Category | ''>('');
  const [results, setResults] = useState<CatalogItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const category = fixedCategory ?? (categoryFilter === '' ? undefined : categoryFilter);

  useEffect(() => {
    const query = text.trim();
    if (query.length < MIN_CATALOG_QUERY_LENGTH) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      setSearchError(null);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      searchCatalog(query, { category, limit: RESULT_LIMIT, signal: controller.signal })
        .then((res) => {
          if (controller.signal.aborted) return;
          setResults(res.items);
          setSearched(true);
          setSearchError(null);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || (err instanceof ApiRequestError && err.code === 'ABORTED')) return;
          setSearchError(errorMessageFor(err, tLoose, locale));
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, category, refreshToken, tLoose, locale]);

  const options = useMemo<ComboboxOption[]>(
    () => results.map((item) => ({
      value: item.id,
      label: catalogDisplayName(item),
      description: `${tLoose(`enums.category.${item.category}`)}${item.phase ? ` · ${item.phase}` : ''}`,
      media: (
        <span className={styles.optionMedia}>
          <ItemImage category={item.category} url={item.imageUrl} size={32} />
        </span>
      ),
    })),
    [results, tLoose],
  );

  const onRefresh = () => {
    setRefreshing(true);
    setRefreshNote(null);
    setSearchError(null);
    refreshCatalog()
      .then((res) => {
        invalidate('catalog.refresh');
        if (!mounted.current) return;
        setRefreshNote(t('itemForm.catalogRefreshed', { date: formatDate(res.catalogUpdatedAt ?? new Date().toISOString(), locale) }));
        setRefreshToken((n) => n + 1);
      })
      .catch((err: unknown) => {
        if (mounted.current) setSearchError(errorMessageFor(err, tLoose, locale));
      })
      .finally(() => {
        if (mounted.current) setRefreshing(false);
      });
  };

  const tooShort = text.trim().length < MIN_CATALOG_QUERY_LENGTH;
  const emptyText = tooShort ? t('itemForm.catalogSearchPlaceholder') : searched ? t('itemForm.catalogNoResults') : t('itemForm.catalogSearching');

  const combobox = (
    <Combobox
      label={label}
      name={name}
      value={null}
      options={options}
      filter="none"
      inputValue={text}
      onInputChange={setText}
      loading={loading && !tooShort}
      emptyText={emptyText}
      placeholder={t('itemForm.catalogSearchPlaceholder')}
      error={error ?? searchError}
      autoFocus={autoFocus}
      onChange={(value) => {
        const picked = results.find((item) => item.id === value);
        if (picked) onSelect(picked);
      }}
      footer={
        hideRefresh ? undefined : (
          <div className={styles.comboFooter}>
            <Button size="sm" variant="ghost" loading={refreshing} onClick={onRefresh}>
              {refreshing ? t('itemForm.catalogRefreshing') : t('itemForm.catalogNotFound')}
            </Button>
            {refreshNote && <span role="status">{refreshNote}</span>}
          </div>
        )
      }
    />
  );

  if (fixedCategory !== undefined) return combobox;
  return (
    <div className={styles.searchRow}>
      <Select
        label={t('itemForm.catalogCategoryFilter')}
        value={categoryFilter === '' ? 'ALL' : categoryFilter}
        onChange={(value) => setCategoryFilter(value === 'ALL' ? '' : (value as Category))}
        options={[
          { value: 'ALL', label: t('filters.categoryAll') },
          ...CATALOG_FILTER_CATEGORIES.map((c) => ({ value: c, label: tLoose(`enums.category.${c}`) })),
        ]}
      />
      {combobox}
    </div>
  );
}
