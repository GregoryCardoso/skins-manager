// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { loadMessages, renderUi } from '@/test/renderUi';
import HelpTip from './HelpTip';

afterEach(cleanup);

describe('HelpTip', () => {
  test('nome acessível traduzido; abre com Enter e mostra o texto', async () => {
    renderUi(<HelpTip topic="Fees">The store charges a fee.</HelpTip>);
    const trigger = screen.getByRole('button', { name: 'Help: Fees' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText('The store charges a fee.')).toBeVisible();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls');
  });

  test('abre com clique; Esc fecha e devolve o foco ao ícone', async () => {
    renderUi(<HelpTip topic="Fees">The store charges a fee.</HelpTip>);
    const trigger = screen.getByRole('button', { name: 'Help: Fees' });
    await userEvent.click(trigger);
    expect(await screen.findByText('The store charges a fee.')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('The store charges a fee.')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  test('em pt-BR o rótulo vem do dicionário', async () => {
    renderUi(<HelpTip topic="Taxas">x</HelpTip>, { language: 'pt-BR', messages: await loadMessages('pt-BR') });
    expect(screen.getByRole('button', { name: 'Ajuda: Taxas' })).toBeInTheDocument();
  });
});
