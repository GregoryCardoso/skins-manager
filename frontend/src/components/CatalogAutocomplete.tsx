'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDate } from '@/lib/format';
import { ApiRequestError, MIN_CATALOG_QUERY_LENGTH, refreshCatalog, searchCatalog } from '@/services/api';
import type { CatalogItem, Category } from '@/types/api';
import styles from './CatalogAutocomplete.module.css';
import FormField from './FormField';
import ItemImage from './ItemImage';

const DEBOUNCE_MS = 250;
const RESULT_LIMIT = 20;

interface Props {
  label: string;
  // Filtro fixo de categoria (ex.: vincular item legado à categoria dele). Sem ele, o usuário pode filtrar.
  fixedCategory?: Category;
  error?: string | null;
  autoFocus?: boolean;
  onSelect: (item: CatalogItem) => void;
}

const CATEGORY_FILTERS: Category[] = [
  'SKIN', 'FACA', 'LUVA', 'CAIXA', 'CAPSULA', 'STICKER', 'PINGENTE', 'PERSONAGEM', 'PASSE_BATALHA',
];

export function catalogDisplayName(item: Pick<CatalogItem, 'name' | 'namePtBr'>, language: string): string {
  return language === 'pt-BR' ? item.namePtBr ?? item.name : item.name;
}

// Busca no catálogo local com debounce, imagem, teclado e atualização do catálogo (D116).
export default function CatalogAutocomplete({ label, fixedCategory, error, autoFocus = false, onSelect }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<Category | ''>('');
  const [results, setResults] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
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
    const text = query.trim();
    if (text.length < MIN_CATALOG_QUERY_LENGTH) {
      setResults([]);
      setTotal(0);
      setSearched(false);
      setLoading(false);
      setSearchError(null);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      searchCatalog(text, { category, limit: RESULT_LIMIT, signal: controller.signal })
        .then((res) => {
          setResults(res.items);
          setTotal(res.meta.total);
          setSearched(true);
          setActive(-1);
          setSearchError(null);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || (err instanceof ApiRequestError && err.code === 'ABORTED')) return;
          setSearchError(errorMessageFor(err, tLoose, language));
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, category, refreshToken, tLoose, language]);

  const choose = (item: CatalogItem) => {
    setOpen(false);
    onSelect(item);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (results.length === 0 ? -1 : (i + 1) % results.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (results.length === 0 ? -1 : (i <= 0 ? results.length - 1 : i - 1)));
    } else if (event.key === 'Enter') {
      // Nunca envia o formulário a partir da busca.
      event.preventDefault();
      const picked = results[active >= 0 ? active : results.length === 1 ? 0 : -1];
      if (open && picked) choose(picked);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    setRefreshNote(null);
    setSearchError(null);
    refreshCatalog()
      .then((res) => {
        if (!mounted.current) return;
        const date = formatDate(res.catalogUpdatedAt ?? new Date().toISOString(), language);
        setRefreshNote(t('itemForm.catalogRefreshed', { date }));
        setRefreshToken((n) => n + 1);
      })
      .catch((err: unknown) => {
        if (mounted.current) setSearchError(errorMessageFor(err, tLoose, language));
      })
      .finally(() => {
        if (mounted.current) setRefreshing(false);
      });
  };

  const showList = open && query.trim().length >= MIN_CATALOG_QUERY_LENGTH;
  const optionId = (index: number) => `${listId}-opt-${index}`;

  return (
    <div className={styles.root}>
      {fixedCategory === undefined && (
        <div className={styles.filter}>
          <label className={styles.filterLabel}>
            {t('itemForm.catalogCategoryFilter')}
            <select
              className={styles.filterSelect}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as Category | '')}
            >
              <option value="">{t('filters.categoryAll')}</option>
              {CATEGORY_FILTERS.map((c) => (
                <option key={c} value={c}>{tLoose(`enums.category.${c}`)}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <FormField label={label} error={error}>
        {(control) => (
          <input
            {...control}
            className={styles.input}
            type="text"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
            autoComplete="off"
            autoFocus={autoFocus}
            placeholder={t('itemForm.catalogSearchPlaceholder')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
        )}
      </FormField>

      {showList && (
        <div className={styles.panel}>
          <ul id={listId} role="listbox" aria-label={label} className={styles.list}>
            {results.map((item, index) => (
              <li
                key={item.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className={`${styles.option} ${index === active ? styles.active : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
                onMouseEnter={() => setActive(index)}
              >
                <ItemImage category={item.category} url={item.imageUrl} size={36} />
                <span className={styles.optionText}>
                  <strong>{catalogDisplayName(item, language)}</strong>
                  <span className={styles.meta}>
                    {tLoose(`enums.category.${item.category}`)}
                    {item.phase ? ` · ${item.phase}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className={styles.footer} aria-live="polite">
            {loading && <span>{t('itemForm.catalogSearching')}</span>}
            {!loading && searched && results.length === 0 && <span>{t('itemForm.catalogNoResults')}</span>}
            {!loading && results.length > 0 && (
              <span>{t('itemForm.catalogShowing', { shown: results.length, total })}</span>
            )}
          </div>
        </div>
      )}

      <div className={styles.refreshRow}>
        <button type="button" className={styles.linkButton} onClick={onRefresh} disabled={refreshing}>
          {refreshing ? t('itemForm.catalogRefreshing') : t('itemForm.catalogNotFound')}
        </button>
        {refreshNote && <span className={styles.meta} role="status">{refreshNote}</span>}
      </div>
      {searchError && <div className={styles.error} role="alert">{searchError}</div>}
    </div>
  );
}
