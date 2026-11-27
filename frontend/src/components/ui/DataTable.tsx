'use client';

import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { CONTAINER_BREAKPOINTS } from '@/styles/breakpoints';
import Checkbox from './Checkbox';
import Icon from './Icon';
import Skeleton from './Skeleton';
import VisuallyHidden from './VisuallyHidden';
import styles from './DataTable.module.css';

export type SortOrder = 'asc' | 'desc';

export interface Column<R> {
  id: string;
  // Texto do cabeçalho (já traduzido). Também é o rótulo da coluna na lista "colunas escondidas" da linha expandida.
  header: string;
  cell: (row: R) => ReactNode;
  align?: 'start' | 'end';
  // Qualquer medida CSS ("8rem"). Sem ela, a coluna se ajusta ao conteúdo.
  width?: string;
  // Largura mínima ("11rem"): evita que o nome do item seja espremido letra por letra; antes disso a tabela passa a rolar.
  minWidth?: string;
  // Só pede a ordenação (onSortChange); quem ordena é a API. Nada é ordenado no frontend.
  sortable?: boolean;
  // Sentido do primeiro clique (padrão: asc).
  firstOrder?: SortOrder;
  // 1 = sempre visível; 2 = some quando a tabela tem menos de 720 px; 3 = some com menos de 960 px (vai para a linha expandida).
  priority?: 1 | 2 | 3;
  // Cabeçalho só para leitor de tela (coluna de ações).
  hideHeader?: boolean;
  // Elemento auxiliar ao lado do nome no cabeçalho (por exemplo, um HelpTip). Fica fora do botão de ordenar e fora do aria-sort/nome da coluna.
  headerAddon?: ReactNode;
  // Presa na borda direita da tabela enquanto o resto rola na horizontal (coluna de ações; pedido do usuário na 12.11, para os botões
  // não ficarem atrás da rolagem em janelas estreitas).
  stickyEnd?: boolean;
}

// Classe da célula: alinhamento e coluna presa à direita.
function cellClass(column: { align?: 'start' | 'end'; stickyEnd?: boolean }, end: string, sticky: string): string | undefined {
  const names = [column.align === 'end' ? end : '', column.stickyEnd ? sticky : ''].filter(Boolean).join(' ');
  return names || undefined;
}

export interface ExpandContext {
  // Quantas colunas a linha tem agora (para um <td colSpan>).
  colSpan: number;
}

export interface DataTableProps<R> {
  // Nome da tabela (visualmente oculto; vira o nome da região rolável).
  caption: string;
  columns: Column<R>[];
  rows: R[];
  getRowId: (row: R) => string;
  density?: 'compact' | 'comfortable';
  sort?: { columnId: string; order: SortOrder } | null;
  onSortChange?: (columnId: string, order: SortOrder) => void;
  expandable?: {
    canExpand?: (row: R) => boolean;
    isExpanded: (id: string) => boolean;
    onToggle: (id: string) => void;
    rowLabel: (row: R) => string;
    // Devolve <tr>s (linhas filhas, com a borda --brand à esquerda). Receba as colunas escondidas para mostrá-las.
    renderExpanded: (row: R, hiddenColumns: Column<R>[], context: ExpandContext) => ReactNode;
  };
  selection?: {
    selectedIds: ReadonlySet<string>;
    onChange: (ids: Set<string>) => void;
    rowLabel: (row: R) => string;
    // Texto completo do rótulo da caixa da linha (padrão: "Selecionar {rowLabel}").
    ariaLabel?: (row: R) => string;
    // Seleção parcial da linha (por exemplo, só parte das unidades de um grupo): a caixa mostra o estado misto.
    isIndeterminate?: (row: R) => boolean;
  };
  rowTone?: (row: R) => 'stuck' | 'lock' | undefined;
  // Linha apontada por um link (`?item=`): ganha aria-current e um realce.
  highlightedId?: string | null;
  // Nome da linha para o botão de expandir quando não há `expandable` (as colunas escondidas viram a linha expandida).
  rowLabel?: (row: R) => string;
  loading?: boolean;
  // Mostrado no lugar das linhas quando não há nenhuma (por exemplo, um <EmptyState>).
  empty?: ReactNode;
  stickyHeader?: boolean;
  // Rodapé dentro do cartão (por exemplo, a legenda da régua de giro).
  footer?: ReactNode;
  // Larguras da tabela (px) abaixo das quais somem as colunas de prioridade 2 e 3 (padrão: 720 e 960).
  hideAt?: HideAt;
  className?: string;
}

const LOADING_ROWS = 5;

// Colunas que cabem na largura da tabela (não da janela): menos de 960 px esconde as de prioridade 3; menos de 720 px, também as de
// prioridade 2. Sem largura medida (servidor, testes em jsdom), todas aparecem.
// `hideAt` troca esses limites numa tabela com muitas colunas (por exemplo, o inventário), para a coluna de ações não ficar atrás da rolagem.
export interface HideAt {
  2?: number;
  3?: number;
}

export function splitColumns<R>(
  columns: Column<R>[],
  width: number | null,
  hideAt: HideAt = {},
): { visible: Column<R>[]; hidden: Column<R>[] } {
  const below3 = hideAt[3] ?? CONTAINER_BREAKPOINTS.lg;
  const below2 = hideAt[2] ?? CONTAINER_BREAKPOINTS.md;
  const hides = (column: Column<R>) => {
    if (width === null) return false;
    const priority = column.priority ?? 1;
    return (priority === 3 && width < below3) || (priority === 2 && width < below2);
  };
  return { visible: columns.filter((column) => !hides(column)), hidden: columns.filter(hides) };
}

// Mede a largura útil do rolável e se ele precisa rolar (as colunas de prioridade 1 não couberam).
function useMeasure() {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ width: number | null; scrollable: boolean }>({ width: null, scrollable: false });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth || null;
      const scrollable = element.scrollWidth > element.clientWidth + 1;
      setState((current) => (current.width === width && current.scrollable === scrollable ? current : { width, scrollable }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, ...state };
}

// Linha filha de largura total: o corpo padrão das colunas escondidas.
export function DetailsRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className={styles.details}>
        <div className={styles.detailsInner}>{children}</div>
      </td>
    </tr>
  );
}

// Lista (<dl>) das colunas escondidas de uma linha, para o conteúdo da linha expandida.
export function HiddenColumnsList<R>({ row, columns }: { row: R; columns: Column<R>[] }) {
  if (columns.length === 0) return null;
  return (
    <dl className={styles.hiddenList}>
      {columns.map((column) => (
        <div key={column.id} className={styles.hiddenItem}>
          <dt>{column.header}</dt>
          <dd>{column.cell(row)}</dd>
        </div>
      ))}
    </dl>
  );
}

// Base das tabelas (D370, 12.3b). Cabeçalho ordenável com aria-sort (só emite onSortChange), linhas expansíveis, seleção, densidade,
// carregando e vazio. Em largura estreita (a da própria tabela), colunas de prioridade 2 e 3 saem e passam para a linha expandida; a
// tabela só rola na horizontal se as de prioridade 1 não couberem. Cada linha é um <tbody> (a principal + as filhas), para o botão de
// expandir poder apontar com aria-controls.
export default function DataTable<R>({
  caption,
  columns,
  rows,
  getRowId,
  density = 'compact',
  sort = null,
  onSortChange,
  expandable,
  selection,
  rowTone,
  highlightedId = null,
  rowLabel,
  loading = false,
  empty,
  stickyHeader = false,
  footer,
  hideAt,
  className,
}: DataTableProps<R>) {
  const t = useT();
  const uid = useId();
  const { ref, width, scrollable } = useMeasure();
  const [internalOpen, setInternalOpen] = useState<ReadonlySet<string>>(new Set());

  const { visible, hidden } = splitColumns(columns, width, hideAt);
  const hasExpander = expandable !== undefined || hidden.length > 0;
  const utilityCount = (hasExpander ? 1 : 0) + (selection ? 1 : 0);
  const colSpan = visible.length + utilityCount;

  const nameOf = (row: R) => expandable?.rowLabel(row) ?? rowLabel?.(row) ?? selection?.rowLabel(row) ?? getRowId(row);
  const isOpen = (id: string) => (expandable ? expandable.isExpanded(id) : internalOpen.has(id));
  const toggle = (id: string) => {
    if (expandable) {
      expandable.onToggle(id);
      return;
    }
    setInternalOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const canExpandRow = (row: R) => hidden.length > 0 || (expandable ? (expandable.canExpand?.(row) ?? true) : false);

  const ids = rows.map(getRowId);
  const selectedCount = selection ? ids.filter((id) => selection.selectedIds.has(id)).length : 0;
  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const changeAll = (checked: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selectedIds);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    selection.onChange(next);
  };
  const changeRow = (id: string, checked: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    selection.onChange(next);
  };

  const renderChildren = (row: R) => {
    if (expandable) return expandable.renderExpanded(row, hidden, { colSpan });
    return (
      <DetailsRow colSpan={colSpan}>
        <HiddenColumnsList row={row} columns={hidden} />
      </DetailsRow>
    );
  };

  return (
    <div className={`${styles.card} ${className ?? ''}`}>
      <div
        ref={ref}
        className={`${styles.scroller} ${stickyHeader ? styles.sticky : ''}`}
        data-scrollable={scrollable || undefined}
        // Largura visível do rolável, para conteúdo da linha expandida que deve caber na tela (a tabela das unidades do grupo).
        style={width !== null ? ({ '--scroller-w': `${width}px` } as CSSProperties) : undefined}
        role={scrollable ? 'region' : undefined}
        tabIndex={scrollable ? 0 : undefined}
        aria-label={scrollable ? t('ui.table.scrollRegion', { caption }) : undefined}
        aria-busy={loading || undefined}
      >
        <table className={styles.table} data-density={density}>
          <caption className={styles.caption}>
            <VisuallyHidden>{caption}</VisuallyHidden>
          </caption>
          <thead>
            <tr>
              {hasExpander && (
                <th scope="col" className={styles.utility}>
                  <VisuallyHidden>{t('ui.table.expandColumn')}</VisuallyHidden>
                </th>
              )}
              {selection && (
                <th scope="col" className={styles.utility}>
                  <Checkbox
                    label={null}
                    aria-label={t('ui.table.selectAll')}
                    checked={allSelected}
                    indeterminate={!allSelected && (selectedCount > 0 || rows.some((row) => selection.isIndeterminate?.(row) === true))}
                    disabled={rows.length === 0}
                    onChange={changeAll}
                  />
                </th>
              )}
              {visible.map((column) => {
                const sorted = sort?.columnId === column.id;
                const ariaSort = column.sortable ? (sorted ? (sort?.order === 'asc' ? 'ascending' : 'descending') : 'none') : undefined;
                const headerText = column.hideHeader ? <VisuallyHidden>{column.header}</VisuallyHidden> : column.header;
                const nextOrder: SortOrder = sorted ? (sort?.order === 'asc' ? 'desc' : 'asc') : (column.firstOrder ?? 'asc');
                const headContent = column.sortable ? (
                  <button type="button" className={`${styles.sortButton} ${sorted ? styles.sorted : ''}`} onClick={() => onSortChange?.(column.id, nextOrder)}>
                    <span>{headerText}</span>
                    <span className={styles.sortIcon}>
                      <Icon name={sorted && sort?.order === 'desc' ? 'arrowDown' : 'arrowUp'} size={14} />
                    </span>
                  </button>
                ) : (
                  headerText
                );
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={ariaSort}
                    aria-label={column.headerAddon ? column.header : undefined}
                    data-priority={column.priority ?? 1}
                    className={cellClass(column, styles.end, styles.stickyEnd)}
                    style={column.width || column.minWidth ? { width: column.width, minWidth: column.minWidth } : undefined}
                  >
                    {column.headerAddon ? (
                      <span className={styles.headCell}>
                        {headContent}
                        {column.headerAddon}
                      </span>
                    ) : (
                      headContent
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          {loading ? (
            <tbody>
              {Array.from({ length: LOADING_ROWS }, (_, index) => (
                <tr key={index} className={styles.skeletonRow}>
                  {Array.from({ length: utilityCount }, (_, i) => (
                    <td key={`u${i}`} className={styles.utility} />
                  ))}
                  {visible.map((column) => (
                    <td key={column.id} data-priority={column.priority ?? 1} className={cellClass(column, '', styles.stickyEnd)}>
                      <Skeleton width="70%" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ) : rows.length === 0 ? (
            empty !== undefined && (
              <tbody>
                <tr>
                  <td colSpan={Math.max(colSpan, 1)} className={styles.empty}>
                    {empty}
                  </td>
                </tr>
              </tbody>
            )
          ) : (
            rows.map((row, rowIndex) => {
              const id = getRowId(row);
              const open = isOpen(id);
              const tone = rowTone?.(row);
              const expandableRow = canExpandRow(row);
              // A chave da linha pode ter espaços e símbolos; um id HTML não pode ter espaço e o aria-controls separa ids por espaço.
              const groupId = `${uid}-row-${rowIndex}`;
              return (
                <tbody key={id} id={groupId}>
                  <tr data-row-id={id} data-tone={tone} data-open={open || undefined} aria-current={highlightedId === id ? 'true' : undefined} data-selected={selection?.selectedIds.has(id) || undefined}>
                    {hasExpander && (
                      <td className={styles.utility}>
                        {expandableRow && (
                          <button
                            type="button"
                            className={styles.expander}
                            aria-expanded={open}
                            aria-controls={groupId}
                            aria-label={t(open ? 'ui.table.collapseRow' : 'ui.table.expandRow', { name: nameOf(row) })}
                            onClick={() => toggle(id)}
                          >
                            <Icon name="chevronRight" size={16} />
                          </button>
                        )}
                      </td>
                    )}
                    {selection && (
                      <td className={styles.utility}>
                        <Checkbox
                          label={null}
                          aria-label={selection.ariaLabel ? selection.ariaLabel(row) : t('ui.table.selectRow', { name: selection.rowLabel(row) })}
                          checked={selection.selectedIds.has(id)}
                          indeterminate={selection.isIndeterminate?.(row) === true}
                          onChange={(checked) => changeRow(id, checked)}
                        />
                      </td>
                    )}
                    {visible.map((column) => (
                      <td key={column.id} data-priority={column.priority ?? 1} className={cellClass(column, styles.end, styles.stickyEnd)}>
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                  {open && expandableRow && renderChildren(row)}
                </tbody>
              );
            })
          )}
        </table>
      </div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}
