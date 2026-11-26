'use client';

import * as Popover from '@radix-ui/react-popover';
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocale, useT, useTPlural } from '@/i18n/I18nProvider';
import { matchesSearch, normalizeForSearch } from '@/lib/search';
import Field from './Field';
import Icon from './Icon';
import styles from './Combobox.module.css';
import VisuallyHidden from './VisuallyHidden';

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  keywords?: string[];
  group?: string;
  media?: ReactNode;
  disabled?: boolean;
}

export interface ComboboxProps {
  label: string;
  value: string | null;
  onChange: (value: string | null, option: ComboboxOption | null) => void;
  options: ComboboxOption[];
  // Ordem e rótulo dos grupos; sem isso, lista plana.
  groups?: { id: string; label: string }[];
  // Valores no topo, no grupo "Mais usadas" (sem repetir mais abaixo).
  pinned?: string[];
  // 'none' = o chamador filtra (catálogo, busca no backend).
  filter?: 'local' | 'none';
  inputValue?: string;
  onInputChange?: (text: string) => void;
  loading?: boolean;
  emptyText?: string;
  footer?: ReactNode;
  renderOption?: (option: ComboboxOption, state: { active: boolean; selected: boolean }) => ReactNode;
  placeholder?: string;
  hint?: ReactNode;
  error?: string | null;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  clearable?: boolean;
  name?: string;
  className?: string;
}

interface Section {
  id: string;
  label: string | null;
  options: ComboboxOption[];
}

const PINNED_ID = '__pinned__';

// Combobox com busca (ARIA 1.2: combobox com listbox) sobre o Popover do Radix, ancorado no input. O foco fica sempre no input.
export default function Combobox({
  label,
  value,
  onChange,
  options,
  groups,
  pinned,
  filter = 'local',
  inputValue,
  onInputChange,
  loading = false,
  emptyText,
  footer,
  renderOption,
  placeholder,
  hint,
  error,
  disabled,
  required,
  autoFocus,
  clearable = false,
  name,
  className,
}: ComboboxProps) {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;

  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [innerText, setInnerText] = useState('');
  const [activeValue, setActiveValue] = useState<string | null>(null);
  // Rótulo do valor escolhido, guardado: com `filter="none"` a opção escolhida pode sair da lista quando o chamador refiltra.
  const chosenLabel = useRef<string>('');

  const selected = value === null ? null : options.find((option) => option.value === value) ?? null;
  if (selected) chosenLabel.current = selected.label;
  if (value === null) chosenLabel.current = '';
  const selectedLabel = selected?.label ?? (value === null ? '' : chosenLabel.current);

  const controlled = inputValue !== undefined;
  const text = controlled ? inputValue : typing ? innerText : selectedLabel;
  const query = typing ? text : '';

  const setText = (next: string) => {
    setInnerText(next);
    onInputChange?.(next);
  };

  const visible = useMemo(() => {
    if (filter === 'none' || query.trim() === '') return options;
    return options.filter((option) => matchesSearch(query, [option.label, option.value, ...(option.keywords ?? [])], locale));
  }, [options, filter, query, locale]);

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    const pinnedSet = new Set(pinned ?? []);
    if (pinned && pinned.length > 0) {
      const top = pinned.map((v) => visible.find((option) => option.value === v)).filter((o): o is ComboboxOption => !!o);
      if (top.length > 0) out.push({ id: PINNED_ID, label: t('ui.combobox.pinned'), options: top });
    }
    const rest = visible.filter((option) => !pinnedSet.has(option.value));
    if (!groups) {
      if (rest.length > 0) out.push({ id: '', label: null, options: rest });
      return out;
    }
    const known = new Set(groups.map((group) => group.id));
    for (const group of groups) {
      const inGroup = rest.filter((option) => option.group === group.id);
      if (inGroup.length > 0) out.push({ id: group.id, label: group.label, options: inGroup });
    }
    const loose = rest.filter((option) => !option.group || !known.has(option.group));
    if (loose.length > 0) out.push({ id: '', label: null, options: loose });
    return out;
  }, [visible, groups, pinned, t]);

  const flat = useMemo(() => sections.flatMap((section) => section.options), [sections]);
  const enabledIndexes = flat.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0);
  const activeIndex = activeValue === null ? -1 : flat.findIndex((option) => option.value === activeValue);

  const moveActive = (index: number) => {
    const option = flat[index];
    if (!option) return;
    setActiveValue(option.value);
    requestAnimationFrame(() => document.getElementById(optionId(index))?.scrollIntoView?.({ block: 'nearest' }));
  };

  const openList = (focusSelected = true) => {
    if (disabled) return;
    setOpen(true);
    if (activeIndex < 0 && enabledIndexes.length > 0) {
      const selectedIndex = focusSelected ? flat.findIndex((option) => option.value === value && !option.disabled) : -1;
      setActiveValue(flat[selectedIndex >= 0 ? selectedIndex : enabledIndexes[0]].value);
    }
  };

  const closeList = () => {
    setOpen(false);
    setActiveValue(null);
  };

  const choose = (option: ComboboxOption) => {
    if (option.disabled) return;
    chosenLabel.current = option.label;
    setTyping(false);
    setInnerText(option.label);
    onInputChange?.(option.label);
    closeList();
    onChange(option.value, option);
  };

  const restoreText = () => {
    setTyping(false);
    setInnerText(selectedLabel);
    onInputChange?.(selectedLabel);
  };

  const step = (direction: 1 | -1) => {
    if (enabledIndexes.length === 0) return;
    const position = enabledIndexes.indexOf(activeIndex);
    const next = position < 0 ? (direction === 1 ? 0 : enabledIndexes.length - 1) : (position + direction + enabledIndexes.length) % enabledIndexes.length;
    moveActive(enabledIndexes[next]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openList();
        else if (!event.altKey) step(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openList();
        else step(-1);
        break;
      case 'Enter':
        if (open && activeIndex >= 0) {
          event.preventDefault();
          choose(flat[activeIndex]);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          closeList();
        } else if (typing) {
          event.preventDefault();
          event.stopPropagation();
          restoreText();
        }
        break;
      default:
        break;
    }
  };

  const onBlur = () => {
    // Fora do componente: fecha. Texto que não corresponde a uma opção volta ao rótulo do valor atual (Tab nunca escolhe sozinho).
    closeList();
    if (!typing) return;
    const exact = options.find((option) => normalizeForSearch(option.label, locale) === normalizeForSearch(text, locale) && !option.disabled);
    if (exact && exact.value !== value) choose(exact);
    else if (text.trim() === '' && clearable && value !== null) {
      setTyping(false);
      onChange(null, null);
    } else restoreText();
  };

  const showClear = clearable && !disabled && (value !== null || text !== '');
  const count = flat.length;
  const liveText = open && !loading ? (count === 0 ? t('ui.combobox.noResults', { query }) : tPlural('ui.combobox.resultCount', count)) : '';

  return (
    <Field label={label} hint={hint} error={error} required={required} name={name} className={className}>
      {(control) => (
        <Popover.Root open={open && !disabled} onOpenChange={(next) => (next ? undefined : closeList())} modal={false}>
          <Popover.Anchor asChild>
            <div ref={anchorRef} className={`${styles.wrap} ${control['aria-invalid'] ? styles.invalid : ''} ${disabled ? styles.disabled : ''}`}>
              <Icon name="search" size={16} className={styles.leading} />
              <input
                {...control}
                ref={inputRef}
                role="combobox"
                aria-expanded={open}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
                autoComplete="off"
                className={styles.input}
                value={text}
                placeholder={placeholder}
                disabled={disabled}
                autoFocus={autoFocus}
                onChange={(event) => {
                  setTyping(true);
                  setText(event.target.value);
                  if (!open) setOpen(true);
                  setActiveValue(null);
                }}
                onClick={() => (open ? undefined : openList())}
                onKeyDown={onKeyDown}
                onBlur={onBlur}
              />
              {showClear && (
                <button
                  type="button"
                  tabIndex={-1}
                  className={styles.adornment}
                  aria-label={t('ui.combobox.clear')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setTyping(false);
                    setInnerText('');
                    onInputChange?.('');
                    onChange(null, null);
                    inputRef.current?.focus();
                  }}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
              <button
                type="button"
                tabIndex={-1}
                className={styles.adornment}
                aria-label={t('ui.combobox.showOptions')}
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  inputRef.current?.focus();
                  if (open) closeList();
                  else openList();
                }}
              >
                <Icon name="chevronDown" size={16} />
              </button>
            </div>
          </Popover.Anchor>
          <VisuallyHidden>
            <span role="status" aria-live="polite">
              {liveText}
            </span>
          </VisuallyHidden>
          <Popover.Portal>
            <Popover.Content
              className={styles.popover}
              align="start"
              sideOffset={4}
              collisionPadding={8}
              avoidCollisions
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onEscapeKeyDown={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
              }}
              // Clicar numa opção não tira o foco do input.
              onMouseDown={(event) => event.preventDefault()}
            >
              <div ref={listRef} id={listId} role="listbox" aria-label={label} aria-busy={loading || undefined} className={styles.list}>
                {sections.map((section) => {
                  const headingId = `${baseId}-grp-${section.id || 'none'}`;
                  const items = section.options.map((option) => {
                    const index = flat.indexOf(option);
                    const isSelected = option.value === value;
                    const isActive = index === activeIndex;
                    return (
                      <div
                        key={option.value}
                        id={optionId(index)}
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled={option.disabled || undefined}
                        className={`${styles.option} ${isActive ? styles.active : ''} ${option.disabled ? styles.optionDisabled : ''}`}
                        onClick={() => choose(option)}
                        onMouseMove={() => (option.disabled || isActive ? undefined : setActiveValue(option.value))}
                      >
                        {renderOption ? (
                          renderOption(option, { active: isActive, selected: isSelected })
                        ) : (
                          <>
                            {option.media}
                            <span className={styles.optionText}>
                              <span>{option.label}</span>
                              {option.description && <span className={styles.description}>{option.description}</span>}
                            </span>
                            {isSelected && <Icon name="check" size={14} />}
                          </>
                        )}
                      </div>
                    );
                  });
                  return section.label ? (
                    <div key={section.id} role="group" aria-labelledby={headingId}>
                      <div id={headingId} className={styles.groupLabel}>
                        {section.label}
                      </div>
                      {items}
                    </div>
                  ) : (
                    <div key={section.id || 'none'}>{items}</div>
                  );
                })}
              </div>
              {loading && <div className={styles.note}>{t('common.loading')}</div>}
              {!loading && count === 0 && <div className={styles.note}>{emptyText ?? t('ui.combobox.noResults', { query })}</div>}
              {footer && <div className={styles.footer}>{footer}</div>}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </Field>
  );
}
