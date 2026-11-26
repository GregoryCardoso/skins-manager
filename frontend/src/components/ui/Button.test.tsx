// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderUi } from '@/test/renderUi';
import Button from './Button';

afterEach(cleanup);

describe('Button', () => {
  test('clique chama onClick; type padrão é button', async () => {
    const onClick = vi.fn();
    renderUi(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('desabilitado não dispara e usa o atributo nativo', async () => {
    const onClick = vi.fn();
    renderUi(<Button disabled onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  test('carregando: aria-busy, aria-disabled, clique ignorado e o foco fica', async () => {
    const onClick = vi.fn();
    renderUi(<Button loading onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    button.focus();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
  });

  test('carregando em submit não envia o formulário', async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    renderUi(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading>
          Send
        </Button>
      </form>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('iconOnlyBelow mantém o nome acessível (texto continua no DOM)', () => {
    renderUi(<Button icon="refresh" iconOnlyBelow="narrow">Refresh</Button>);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  test('variantes e tamanhos viram classes; ícone é decorativo', () => {
    const { container } = renderUi(<Button variant="primary" size="lg" icon="plus">Add</Button>);
    const button = screen.getByRole('button', { name: 'Add' });
    expect(button.className).toMatch(/primary/);
    expect(button.className).toMatch(/lg/);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  test('o TypeScript exige icon com iconOnlyBelow', () => {
    // @ts-expect-error iconOnlyBelow sem icon
    const invalid = <Button iconOnlyBelow="narrow">x</Button>;
    expect(invalid).toBeTruthy();
  });
});
