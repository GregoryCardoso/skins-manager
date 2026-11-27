// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadMessages, renderUi } from '@/test/renderUi';
import DataTable, { DetailsRow, HiddenColumnsList, splitColumns, type Column, type SortOrder } from './DataTable';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface Row {
  id: string;
  name: string;
  qty: number;
  store: string;
  note: string;
}

const ROWS: Row[] = [
  { id: 'a', name: 'AK-47 | Redline', qty: 3, store: 'CSFloat', note: 'n1' },
  { id: 'b', name: 'AWP | Asiimov', qty: 2, store: 'Steam', note: 'n2' },
  { id: 'c', name: 'Glock-18 | Fade', qty: 1, store: 'CS.MONEY', note: 'n3' },
];

const COLUMNS: Column<Row>[] = [
  { id: 'name', header: 'Item', sortable: true, cell: (r) => r.name },
  { id: 'qty', header: 'Qty', align: 'end', sortable: true, cell: (r) => r.qty },
  { id: 'store', header: 'Store', priority: 2, cell: (r) => r.store },
  { id: 'note', header: 'Note', priority: 3, cell: (r) => r.note },
  { id: 'act', header: 'Actions', hideHeader: true, cell: () => <button type="button">Sell</button> },
];

function mockWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
}

describe('DataTable: estrutura e cabeçalho', () => {
  test('caption, cabeçalhos e linhas; o cabeçalho escondido continua acessível', () => {
    renderUi(<DataTable caption="Inventory" columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} />);
    const table = screen.getByRole('table', { name: 'Inventory' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Item', 'Qty', 'Store', 'Note', 'Actions']);
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
  });

  test('data-priority em cabeçalhos e células', () => {
    renderUi(<DataTable caption="Inventory" columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((h) => h.getAttribute('data-priority'))).toEqual(['1', '1', '2', '3', '1']);
    const firstRow = screen.getAllByRole('row')[1];
    expect(within(firstRow).getAllByRole('cell').map((c) => c.getAttribute('data-priority'))).toEqual(['1', '1', '2', '3', '1']);
  });

  test('aria-sort só nas colunas ordenáveis (none quando não ordenadas)', () => {
    renderUi(<DataTable caption="Inventory" columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} sort={{ columnId: 'qty', order: 'desc' }} />);
    expect(screen.getByRole('columnheader', { name: 'Item' })).toHaveAttribute('aria-sort', 'none');
    expect(screen.getByRole('columnheader', { name: 'Qty' })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: 'Store' })).not.toHaveAttribute('aria-sort');
  });

  test('ascendente vira "ascending"', () => {
    renderUi(<DataTable caption="Inventory" columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} sort={{ columnId: 'name', order: 'asc' }} />);
    expect(screen.getByRole('columnheader', { name: 'Item' })).toHaveAttribute('aria-sort', 'ascending');
  });

  test('clicar no cabeçalho só emite onSortChange e NÃO reordena as linhas', async () => {
    const onSortChange = vi.fn();
    renderUi(<DataTable caption="Inventory" columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} onSortChange={onSortChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Qty' }));
    expect(onSortChange).toHaveBeenCalledWith('qty', 'asc');
    const names = screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(names).toEqual(['AK-47 | Redline', 'AWP | Asiimov', 'Glock-18 | Fade']);
  });

  test('o clique alterna o sentido da coluna já ordenada; firstOrder muda o primeiro clique', async () => {
    const onSortChange = vi.fn();
    const columns: Column<Row>[] = [{ id: 'qty', header: 'Qty', sortable: true, firstOrder: 'desc', cell: (r) => r.qty }, { id: 'name', header: 'Item', sortable: true, cell: (r) => r.name }];
    const { rerender } = renderUi(<DataTable caption="T" columns={columns} rows={ROWS} getRowId={(r) => r.id} onSortChange={onSortChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Qty' }));
    expect(onSortChange).toHaveBeenLastCalledWith('qty', 'desc');
    rerender(<DataTable caption="T" columns={columns} rows={ROWS} getRowId={(r) => r.id} onSortChange={onSortChange} sort={{ columnId: 'qty', order: 'desc' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Qty' }));
    expect(onSortChange).toHaveBeenLastCalledWith('qty', 'asc');
    await userEvent.click(screen.getByRole('button', { name: 'Item' }));
    expect(onSortChange).toHaveBeenLastCalledWith('name', 'asc');
  });
});

function Expandable({ canExpand }: { canExpand?: (row: Row) => boolean }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  return (
    <DataTable
      caption="Inventory"
      columns={COLUMNS}
      rows={ROWS}
      getRowId={(r) => r.id}
      expandable={{
        canExpand,
        isExpanded: (id) => open.has(id),
        onToggle: (id) => setOpen((current) => (current.has(id) ? new Set([...current].filter((x) => x !== id)) : new Set([...current, id]))),
        rowLabel: (r) => r.name,
        renderExpanded: (row, hidden, ctx) => (
          <>
            <DetailsRow colSpan={ctx.colSpan}>
              <span>unit of {row.name}</span>
              <HiddenColumnsList row={row} columns={hidden} />
            </DetailsRow>
          </>
        ),
      }}
    />
  );
}

describe('DataTable: expansão', () => {
  test('o botão tem nome com o item, aria-expanded e aria-controls', async () => {
    renderUi(<Expandable />);
    const button = screen.getByRole('button', { name: 'Show units of AK-47 | Redline' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const controls = button.getAttribute('aria-controls') as string;
    expect(document.getElementById(controls)).not.toBeNull();
    await userEvent.click(button);
    const opened = screen.getByRole('button', { name: 'Hide units of AK-47 | Redline' });
    expect(opened).toHaveAttribute('aria-expanded', 'true');
    expect(within(document.getElementById(controls) as HTMLElement).getByText('unit of AK-47 | Redline')).toBeInTheDocument();
    await userEvent.click(opened);
    expect(screen.queryByText('unit of AK-47 | Redline')).toBeNull();
  });

  test('canExpand falso: sem botão naquela linha', () => {
    renderUi(<Expandable canExpand={(row) => row.id === 'a'} />);
    expect(screen.getAllByRole('button', { name: /Show units of/ })).toHaveLength(1);
  });

  test('o nome do botão vem do idioma', async () => {
    const messages = await loadMessages('pt-BR');
    renderUi(<Expandable />, { language: 'pt-BR', messages });
    expect(screen.getByRole('button', { name: 'Mostrar unidades de AK-47 | Redline' })).toBeInTheDocument();
  });
});

describe('DataTable: colunas por largura (container)', () => {
  test('splitColumns: sem largura tudo aparece; < 960 esconde 3; < 720 esconde 2 e 3', () => {
    expect(splitColumns(COLUMNS, null).hidden).toEqual([]);
    expect(splitColumns(COLUMNS, 1000).hidden.map((c) => c.id)).toEqual([]);
    expect(splitColumns(COLUMNS, 959).hidden.map((c) => c.id)).toEqual(['note']);
    expect(splitColumns(COLUMNS, 719).hidden.map((c) => c.id)).toEqual(['store', 'note']);
    expect(splitColumns(COLUMNS, 719).visible.map((c) => c.id)).toEqual(['name', 'qty', 'act']);
  });

  test('splitColumns com hideAt: limites próprios da tabela (inventário: 1280 e 1000); o que não vier usa o padrão', () => {
    const hideAt = { 2: 1000, 3: 1280 };
    expect(splitColumns(COLUMNS, 1280, hideAt).hidden).toEqual([]);
    expect(splitColumns(COLUMNS, 1279, hideAt).hidden.map((c) => c.id)).toEqual(['note']);
    expect(splitColumns(COLUMNS, 999, hideAt).hidden.map((c) => c.id)).toEqual(['store', 'note']);
    expect(splitColumns(COLUMNS, 959, { 3: 1280 }).hidden.map((c) => c.id)).toEqual(['note']);
    expect(splitColumns(COLUMNS, 719, { 3: 1280 }).hidden.map((c) => c.id)).toEqual(['store', 'note']);
    expect(splitColumns(COLUMNS, null, hideAt).hidden).toEqual([]);
  });

  test('hideAt na tabela: com 1100 px, a coluna 3 some mesmo acima de 960', () => {
    mockWidth(1100);
    renderUi(<DataTable caption="Inventory" columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} rowLabel={(r) => r.name} hideAt={{ 3: 1280 }} />);
    expect(screen.queryByRole('columnheader', { name: 'Note' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Store' })).toBeInTheDocument();
  });

  test('largura média: some a coluna 3 e a linha ganha o expansor (sem `expandable`)', async () => {
    mockWidth(800);
    renderUi(<DataTable caption="Inventory" columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} rowLabel={(r) => r.name} />);
    expect(screen.queryByRole('columnheader', { name: 'Note' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Store' })).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Show units of AK-47 | Redline' });
    await userEvent.click(button);
    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.getByText('n1')).toBeInTheDocument();
  });

  test('largura estreita: somem as colunas 2 e 3 e a linha expandida as lista em um <dl>', async () => {
    mockWidth(500);
    const { container } = renderUi(<DataTable caption="Inventory" columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} rowLabel={(r) => r.name} />);
    expect(screen.queryByRole('columnheader', { name: 'Store' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Note' })).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: /Show units of/ })[0]);
    const list = container.querySelector('dl') as HTMLElement;
    expect(within(list).getByText('Store')).toBeInTheDocument();
    expect(within(list).getByText('CSFloat')).toBeInTheDocument();
    expect(within(list).getByText('Note')).toBeInTheDocument();
  });

  test('com `expandable`, as colunas escondidas chegam a renderExpanded e o expansor aparece mesmo com canExpand falso', () => {
    mockWidth(500);
    const renderExpanded = vi.fn(() => null);
    renderUi(
      <DataTable
        caption="Inventory"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(r) => r.id}
        expandable={{ canExpand: () => false, isExpanded: () => true, onToggle: () => {}, rowLabel: (r) => r.name, renderExpanded }}
      />,
    );
    expect(screen.getAllByRole('button', { name: /Hide units of/ })).toHaveLength(3);
    const hiddenIds = (renderExpanded.mock.calls as unknown as [Row, Column<Row>[]][])[0][1].map((c) => c.id);
    expect(hiddenIds).toEqual(['store', 'note']);
  });

  test('o rolável só vira região focável quando precisa rolar', () => {
    mockWidth(500);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900);
    renderUi(<DataTable caption="Inventory" columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} />);
    const region = screen.getByRole('region', { name: 'Inventory, scrollable' });
    expect(region).toHaveAttribute('tabindex', '0');
  });

  test('sem precisar rolar, não há região', () => {
    mockWidth(1200);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1000);
    renderUi(<DataTable caption="Inventory" columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} />);
    expect(screen.queryByRole('region')).toBeNull();
  });
});

function Selectable({ initial = [] as string[] }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(initial));
  return (
    <>
      <output data-testid="count">{selected.size}</output>
      <DataTable caption="Inventory" columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} selection={{ selectedIds: selected, onChange: setSelected, rowLabel: (r) => r.name }} />
    </>
  );
}

describe('DataTable: seleção', () => {
  test('selecionar uma linha e selecionar tudo', async () => {
    renderUi(<Selectable />);
    const all = screen.getByRole('checkbox', { name: 'Select all rows' });
    expect(all).not.toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select AK-47 | Redline' }));
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    await userEvent.click(all);
    expect(screen.getByTestId('count')).toHaveTextContent('3');
    expect(all).toBeChecked();
    await userEvent.click(all);
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  test('seleção parcial deixa o cabeçalho indeterminado', () => {
    renderUi(<Selectable initial={['a']} />);
    const all = screen.getByRole('checkbox', { name: 'Select all rows' }) as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);
  });

  test('o nome do checkbox vem do idioma', async () => {
    const messages = await loadMessages('pt-BR');
    renderUi(<Selectable />, { language: 'pt-BR', messages });
    expect(screen.getByRole('checkbox', { name: 'Selecionar todas as linhas' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Selecionar AK-47 | Redline' })).toBeInTheDocument();
  });

  test('sem linhas, o selecionar tudo fica desabilitado', () => {
    renderUi(
      <DataTable caption="T" columns={COLUMNS} rows={[]} getRowId={(r) => r.id} selection={{ selectedIds: new Set<string>(), onChange: () => {}, rowLabel: (r) => r.name }} />,
    );
    expect(screen.getByRole('checkbox', { name: 'Select all rows' })).toBeDisabled();
  });
});

describe('DataTable: estados', () => {
  test('loading: aria-busy, 5 linhas de esqueleto e sem dados', () => {
    const { container } = renderUi(<DataTable caption="Inventory" columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} loading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(screen.queryByText('AK-47 | Redline')).toBeNull();
  });

  test('empty aparece quando não há linhas', () => {
    renderUi(<DataTable caption="Inventory" columns={COLUMNS} rows={[]} getRowId={(r) => r.id} empty={<p>Nothing matches</p>} />);
    expect(screen.getByText('Nothing matches')).toBeInTheDocument();
  });

  test('rowTone e densidade viram atributos de dados', () => {
    const { container } = renderUi(
      <DataTable caption="Inventory" columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} density="comfortable" rowTone={(r) => (r.id === 'a' ? 'stuck' : r.id === 'b' ? 'lock' : undefined)} />,
    );
    expect(container.querySelector('table')).toHaveAttribute('data-density', 'comfortable');
    expect(container.querySelector('tr[data-row-id="a"]')).toHaveAttribute('data-tone', 'stuck');
    expect(container.querySelector('tr[data-row-id="b"]')).toHaveAttribute('data-tone', 'lock');
    expect(container.querySelector('tr[data-row-id="c"]')).not.toHaveAttribute('data-tone');
  });

  test('footer aparece dentro do cartão', () => {
    renderUi(<DataTable caption="Inventory" columns={COLUMNS} rows={ROWS} getRowId={(r) => r.id} footer={<span>Legend here</span>} />);
    expect(screen.getByText('Legend here')).toBeInTheDocument();
  });

  test('a ordem das linhas é a recebida (nada é ordenado no frontend)', () => {
    const reversed = [...ROWS].reverse();
    renderUi(<DataTable caption="Inventory" columns={COLUMNS} rows={reversed} getRowId={(r) => r.id} sort={{ columnId: 'name', order: 'asc' }} />);
    const names = screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(names).toEqual(['Glock-18 | Fade', 'AWP | Asiimov', 'AK-47 | Redline']);
  });
});

// Garante que o tipo SortOrder é o esperado (compilação).
const _order: SortOrder = 'asc';
void _order;
