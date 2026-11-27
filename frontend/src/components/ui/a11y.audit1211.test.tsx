// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { renderUi } from '@/test/renderUi';
import DataTable, { type Column } from './DataTable';
import Dialog from './Dialog';
import HelpTip from './HelpTip';
import TextField from './TextField';

// Correções da auditoria de acessibilidade da 12.11 (parte 1): um teste por correção.

afterEach(cleanup);

interface Row {
  id: string;
  name: string;
}

// Chaves de linha como as do inventário agrupado: espaços e símbolos.
const ROWS: Row[] = [
  { id: 'ak-47 | redline|SKIN|NORMAL|FT|', name: 'AK-47 | Redline' },
  { id: 'awp | asiimov|SKIN|NORMAL|FT|', name: 'AWP | Asiimov' },
];
const COLUMNS: Column<Row>[] = [{ id: 'name', header: 'Item', cell: (row) => row.name }];

describe('DataTable (auditoria 12.11)', () => {
  test('a coluna do botão de expandir tem cabeçalho com nome acessível', () => {
    renderUi(
      <DataTable
        caption="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(row) => row.id}
        expandable={{ rowLabel: (row) => row.name, isExpanded: () => false, onToggle: () => undefined, renderExpanded: () => null }}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Expand details' })).toBeInTheDocument();
    // Nenhum cabeçalho de coluna fica sem nome.
    for (const header of screen.getAllByRole('columnheader')) expect(header.textContent?.trim()).not.toBe('');
  });

  test('aria-controls aponta para um id válido (sem espaços) mesmo com chave de linha com espaços e símbolos', () => {
    renderUi(
      <DataTable
        caption="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(row) => row.id}
        expandable={{ rowLabel: (row) => row.name, isExpanded: () => false, onToggle: () => undefined, renderExpanded: () => null }}
      />,
    );
    const buttons = screen.getAllByRole('button', { name: /^Show units of / });
    expect(buttons).toHaveLength(2);
    const ids = buttons.map((button) => button.getAttribute('aria-controls') as string);
    for (const id of ids) {
      expect(id).not.toMatch(/\s/);
      expect(document.getElementById(id)).not.toBeNull();
    }
    expect(new Set(ids).size).toBe(2);
  });
});

describe('HelpTip (auditoria 12.11)', () => {
  test('o painel aberto (role dialog) tem nome acessível igual ao do botão', async () => {
    renderUi(<HelpTip topic="Fees">The store charges a fee.</HelpTip>);
    await userEvent.click(screen.getByRole('button', { name: 'Help: Fees' }));
    expect(await screen.findByRole('dialog', { name: 'Help: Fees' })).toBeInTheDocument();
  });
});

function Mounting({ withField }: { withField: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setShown(true)}>Open it</button>
      {shown && (
        <Dialog title="Details" onClose={() => setShown(false)} footer={<button type="button">Done</button>}>
          {withField ? <label>Name<input /></label> : <p>Only text here.</p>}
        </Dialog>
      )}
    </>
  );
}

describe('Dialog (auditoria 12.11)', () => {
  test('sem campo no corpo, o foco inicial vai ao diálogo (não ao botão fechar, cuja dica engoliria o primeiro Esc)', async () => {
    renderUi(<Mounting withField={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    const dialog = await screen.findByRole('dialog', { name: 'Details' });
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Close' })).not.toHaveFocus();
  });

  test('sem campo: um único Esc fecha o diálogo e o foco volta a quem abriu', async () => {
    renderUi(<Mounting withField={false} />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    await userEvent.click(opener);
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  test('com campo, o foco inicial continua no primeiro campo', async () => {
    renderUi(<Mounting withField />);
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await screen.findByRole('dialog', { name: 'Details' });
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus());
  });
});

describe('TextField (auditoria 12.11)', () => {
  test('autocomplete desligado por padrão (nenhum campo é de login) e ainda configurável', () => {
    renderUi(
      <>
        <TextField label="Plain" value="" onChange={() => undefined} />
        <TextField label="Custom" value="" onChange={() => undefined} autoComplete="name" />
      </>,
    );
    expect(screen.getByLabelText('Plain')).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText('Custom')).toHaveAttribute('autocomplete', 'name');
  });
});
