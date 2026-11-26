// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderUi } from '@/test/renderUi';
import Checkbox from './Checkbox';
import Switch from './Switch';

afterEach(cleanup);

describe('Checkbox', () => {
  test('Espaço alterna; o rótulo inteiro é clicável', async () => {
    const onChange = vi.fn();
    renderUi(<Checkbox label="Only stuck" checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Only stuck' });
    box.focus();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByText('Only stuck'));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  test('indeterminate é aplicado por ref e some quando marcado', () => {
    const { rerender } = renderUi(<Checkbox label="All" checked={false} indeterminate onChange={() => {}} />);
    expect((screen.getByRole('checkbox', { name: 'All' }) as HTMLInputElement).indeterminate).toBe(true);
    rerender(<Checkbox label="All" checked indeterminate onChange={() => {}} />);
    expect((screen.getByRole('checkbox', { name: 'All' }) as HTMLInputElement).indeterminate).toBe(false);
  });

  test('desabilitado não alterna', async () => {
    const onChange = vi.fn();
    renderUi(<Checkbox label="Off" checked={false} disabled onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Off' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test('marca é ícone decorativo', () => {
    const { container } = renderUi(<Checkbox label="X" checked onChange={() => {}} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Switch', () => {
  test('tem role=switch e alterna', async () => {
    const onChange = vi.fn();
    renderUi(<Switch label="Active" checked={false} onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Active' });
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
