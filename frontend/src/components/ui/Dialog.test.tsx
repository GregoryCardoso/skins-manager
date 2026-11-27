// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderUi } from '@/test/renderUi';
import ConfirmDialog from './ConfirmDialog';
import Dialog from './Dialog';
import Disclosure from './Disclosure';
import Menu from './Menu';
import Tabs, { TabPanel } from './Tabs';

afterEach(cleanup);

// Abre e fecha por montar/desmontar (o padrão das telas) ou por `open` controlado.
function Mounting({ busy = false, onClose }: { busy?: boolean; onClose?: () => void }) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setShown(true)}>Open it</button>
      {shown && (
        <Dialog
          title="Edit item"
          busy={busy}
          onClose={() => {
            onClose?.();
            setShown(false);
          }}
          footer={<button type="button">Save it</button>}
        >
          <label>
            Name
            <input />
          </label>
        </Dialog>
      )}
    </>
  );
}

function Controlled() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open it</button>
      <Dialog open={open} title="Edit item" onClose={() => setOpen(false)}>
        <input aria-label="Name" />
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  test('título liga o diálogo por aria-labelledby; foco inicial no primeiro campo', async () => {
    renderUi(<Mounting />);
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit item' });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus());
  });

  test('Esc fecha e o foco volta a quem abriu (montar/desmontar)', async () => {
    renderUi(<Mounting />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    await userEvent.click(opener);
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  test('o foco volta a quem abriu com `open` controlado', async () => {
    renderUi(<Controlled />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    await userEvent.click(opener);
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  test('com busy: Esc não fecha e o botão fechar fica desabilitado', async () => {
    const onClose = vi.fn();
    renderUi(<Mounting busy onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  });

  test('clicar fora não fecha', async () => {
    const onClose = vi.fn();
    renderUi(<Mounting onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await screen.findByRole('dialog');
    await userEvent.click(document.querySelector<HTMLElement>('[class*="overlay"]')!);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('Tab fica preso dentro do diálogo', async () => {
    renderUi(<Mounting />);
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    const dialog = await screen.findByRole('dialog');
    for (let i = 0; i < 6; i += 1) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});

describe('ConfirmDialog', () => {
  test('role=alertdialog, descrito pela mensagem, foco inicial em Cancelar no danger', async () => {
    renderUi(<ConfirmDialog title="Delete item" message="This cannot be undone." confirmLabel="Delete item" tone="danger" onConfirm={() => {}} onCancel={() => {}} />);
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete item' });
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
  });

  test('confirmar e cancelar chamam os callbacks', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderUi(<ConfirmDialog title="Undo sale" message="Sure?" confirmLabel="Undo sale" onConfirm={onConfirm} onCancel={onCancel} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Undo sale' }));
    expect(onConfirm).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  test('busy: confirmar em loading; erro visível dentro do diálogo', async () => {
    renderUi(<ConfirmDialog title="T" message="M" confirmLabel="Do it" busy error="Server failed" onConfirm={() => {}} onCancel={() => {}} />);
    const confirm = await screen.findByRole('button', { name: 'Do it' });
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Server failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  test('details aparece', async () => {
    renderUi(<ConfirmDialog title="T" message="M" details="Balance changes by US$ 5" confirmLabel="Go" onConfirm={() => {}} onCancel={() => {}} />);
    expect(await screen.findByText('Balance changes by US$ 5')).toBeInTheDocument();
  });
});

describe('Menu', () => {
  const entries = (onSelect: () => void) => [
    { id: 'edit', label: 'Edit', onSelect },
    { type: 'separator' as const },
    { id: 'del', label: 'Delete', tone: 'danger' as const, onSelect: () => {} },
    { id: 'off', label: 'Sell', disabled: true, disabledReason: 'In trade lock', onSelect: () => {} },
  ];

  test('abre com Enter, setas movem, Enter seleciona e fecha', async () => {
    const onSelect = vi.fn();
    renderUi(<Menu items={entries(onSelect)} />);
    const trigger = screen.getByRole('button', { name: 'More actions' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  test('Esc devolve o foco ao gatilho', async () => {
    renderUi(<Menu items={entries(() => {})} />);
    const trigger = screen.getByRole('button', { name: 'More actions' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('menu');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  test('item desabilitado mostra o motivo como texto', async () => {
    renderUi(<Menu items={entries(() => {})} />);
    const trigger = screen.getByRole('button', { name: 'More actions' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const item = await screen.findByRole('menuitem', { name: /Sell/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('In trade lock')).toBeVisible();
  });
});

describe('Tabs', () => {
  function Wrapper() {
    const [value, setValue] = useState('a');
    return (
      <Tabs
        label="Sections"
        value={value}
        onChange={setValue}
        items={[
          { value: 'a', label: 'For sale', count: 3 },
          { value: 'b', label: 'Holding' },
        ]}
      >
        <TabPanel value="a">Panel A</TabPanel>
        <TabPanel value="b">Panel B</TabPanel>
      </Tabs>
    );
  }

  test('setas trocam o painel (ativação automática)', async () => {
    renderUi(<Wrapper />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.getByText('Panel A')).toBeVisible();
    screen.getByRole('tab', { name: /For sale/ }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Holding' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Panel B')).toBeVisible();
    expect(screen.queryByText('Panel A')).toBeNull();
  });
});

describe('Disclosure', () => {
  test('aria-expanded alterna e o rótulo padrão é common.moreDetails', async () => {
    renderUi(<Disclosure>Hidden details</Disclosure>);
    const button = screen.getByRole('button', { name: 'More details' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Hidden details')).toBeNull();
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Hidden details')).toBeVisible();
  });

  test('rótulo próprio e defaultOpen', () => {
    renderUi(<Disclosure label="Advanced" defaultOpen>Inside</Disclosure>);
    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Inside')).toBeInTheDocument();
  });
});

describe('Tabs vertical com descrição (12.8)', () => {
  function Wrapper() {
    const [value, setValue] = useState('a');
    return (
      <Tabs
        label="Sections"
        value={value}
        onChange={setValue}
        orientation="vertical"
        items={[
          { value: 'a', label: 'Preferences', description: 'Dark · English · $' },
          { value: 'b', label: 'Backup' },
        ]}
      >
        <TabPanel value="a">Panel A</TabPanel>
        <TabPanel value="b">Panel B</TabPanel>
      </Tabs>
    );
  }

  test('a lista é vertical, mostra o estado na segunda linha e as setas para baixo e para cima trocam a aba', async () => {
    renderUi(<Wrapper />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toHaveAttribute('aria-orientation', 'vertical');
    expect(screen.getByText('Dark · English · $')).toBeVisible();
    screen.getByRole('tab', { name: /Preferences/ }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: 'Backup' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Panel B')).toBeVisible();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('tab', { name: /Preferences/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('sem orientation continua horizontal (comportamento de antes)', () => {
    renderUi(
      <Tabs label="Sections" value="a" onChange={() => {}} items={[{ value: 'a', label: 'A' }]}>
        <TabPanel value="a">Panel A</TabPanel>
      </Tabs>,
    );
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'horizontal');
  });
});
