// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderUi } from '@/test/renderUi';
import IconButton from './IconButton';

afterEach(cleanup);

describe('IconButton', () => {
  test('label vira o nome acessível e o clique funciona', async () => {
    const onClick = vi.fn();
    renderUi(<IconButton icon="refresh" label="Refresh" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onClick).toHaveBeenCalled();
  });

  test('o TypeScript exige label', () => {
    // @ts-expect-error label é obrigatório
    const invalid = <IconButton icon="refresh" />;
    expect(invalid).toBeTruthy();
  });

  test('pressed vira aria-pressed', () => {
    renderUi(<IconButton icon="lock" label="Lock" pressed />);
    expect(screen.getByRole('button', { name: 'Lock' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('desabilitado e carregando', async () => {
    const onClick = vi.fn();
    renderUi(
      <>
        <IconButton icon="plus" label="Off" disabled onClick={onClick} />
        <IconButton icon="plus" label="Busy" loading onClick={onClick} />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Off' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Busy' })).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Busy' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  test('tem o tooltip com o label ao receber foco', async () => {
    renderUi(<IconButton icon="refresh" label="Refresh" />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Refresh');
  });
});
