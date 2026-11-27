// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { renderUi } from '@/test/renderUi';
import type { ItemComponent } from '@/types/api';
import ComponentThumbs from './ComponentThumbs';
import DataTable, { type Column } from './ui/DataTable';
import HelpTip from './ui/HelpTip';
import Tabs, { TabPanel } from './ui/Tabs';

afterEach(cleanup);

// Decisões do usuário sobre a auditoria da 12.11: B4 (ajuda uma vez no cabeçalho), B5 (dica acessível nas miniaturas) e B7 (nome da aba só
// com o título).

describe('B4: DataTable com elemento auxiliar no cabeçalho', () => {
  interface Row {
    id: string;
    price: number;
  }
  const rows: Row[] = [
    { id: 'a', price: 1 },
    { id: 'b', price: 2 },
  ];
  const columns: Column<Row>[] = [
    { id: 'price', header: 'Break-even price', sortable: true, headerAddon: <HelpTip topic="Break-even price">Explanation</HelpTip>, cell: (r) => r.price },
    { id: 'plain', header: 'Plain', cell: () => 'x' },
  ];

  test('a ajuda aparece uma vez, fora do botão de ordenar; o nome da coluna e o aria-sort continuam', async () => {
    const onSortChange = () => undefined;
    renderUi(<DataTable caption="T" columns={columns} rows={rows} getRowId={(r) => r.id} sort={{ columnId: 'price', order: 'asc' }} onSortChange={onSortChange} />);
    const header = screen.getByRole('columnheader', { name: 'Break-even price' });
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getAllByRole('button', { name: 'Help: Break-even price' })).toHaveLength(1);
    const sortButton = within(header).getByRole('button', { name: 'Break-even price' });
    expect(within(sortButton).queryByRole('button')).toBeNull();
    expect(sortButton.contains(screen.getByRole('button', { name: 'Help: Break-even price' }))).toBe(false);
  });

  test('a ajuda do cabeçalho abre pelo teclado', async () => {
    const user = userEvent.setup();
    renderUi(<DataTable caption="T" columns={columns} rows={rows} getRowId={(r) => r.id} />);
    screen.getByRole('button', { name: 'Help: Break-even price' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Explanation')).toBeInTheDocument();
  });

  test('colunas sem addon continuam iguais (sem aria-label extra)', () => {
    renderUi(<DataTable caption="T" columns={columns} rows={rows} getRowId={(r) => r.id} />);
    expect(screen.getByRole('columnheader', { name: 'Plain' })).not.toHaveAttribute('aria-label');
  });
});

describe('B5: miniaturas de componentes sem title', () => {
  const components: ItemComponent[] = [
    {
      id: 1, kind: 'STICKER', catalogId: 'sticker-1', name: 'Sticker | Natus Vincere (Holo)', localizedName: null, imageUrl: null, slot: 2, wear: 0.1, pattern: null,
      source: 'MANUAL', origin: 'CAME_WITH', sourceItemId: null, operationId: null, undoable: false, scrapeable: false, detachable: false,
    } as ItemComponent,
  ];

  test('cada miniatura recebe foco, tem nome acessível e nenhum title', () => {
    const { container } = renderUi(<ComponentThumbs components={components} />);
    const thumb = screen.getByRole('img', { name: /Natus Vincere/ });
    expect(thumb).toHaveAttribute('tabindex', '0');
    expect(container.querySelector('[title]')).toBeNull();
  });

  test('o foco do teclado abre a dica com os detalhes', async () => {
    const user = userEvent.setup();
    renderUi(<ComponentThumbs components={components} />);
    await user.tab();
    expect(screen.getByRole('img', { name: /Natus Vincere/ })).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Natus Vincere/);
  });
});

describe('B7: aba só com o título no nome, subtítulo como descrição', () => {
  test('o nome acessível é o título e o subtítulo descreve a aba', () => {
    renderUi(
      <Tabs
        label="Sections"
        value="a"
        onChange={() => undefined}
        items={[
          { value: 'a', label: 'Preferences', description: 'Dark · English · US$' },
          { value: 'b', label: 'Backup' },
        ]}
      >
        <TabPanel value="a">A</TabPanel>
        <TabPanel value="b">B</TabPanel>
      </Tabs>,
    );
    const tab = screen.getByRole('tab', { name: 'Preferences' });
    expect(tab).toHaveAccessibleDescription('Dark · English · US$');
    expect(screen.getByRole('tab', { name: 'Backup' })).not.toHaveAttribute('aria-describedby');
    expect(screen.getByText('Dark · English · US$')).toBeVisible();
  });
});
