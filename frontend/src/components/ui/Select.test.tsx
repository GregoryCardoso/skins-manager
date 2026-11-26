// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderUi } from '@/test/renderUi';
import Select from './Select';

afterEach(cleanup);

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

describe('Select', () => {
  test('rótulo e onChange', async () => {
    const onChange = vi.fn();
    renderUi(<Select label="Theme" value="a" onChange={onChange} options={OPTIONS} />);
    const select = screen.getByLabelText('Theme');
    await userEvent.selectOptions(select, 'Beta');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  test('valor vazio mostra o placeholder traduzido (common.select)', () => {
    renderUi(<Select label="Theme" value="" onChange={() => {}} options={OPTIONS} />);
    expect(screen.getByRole('option', { name: 'Choose an option' })).toBeInTheDocument();
  });

  test('desabilitado, erro e dica', () => {
    renderUi(<Select label="Theme" value="a" onChange={() => {}} options={OPTIONS} disabled error="Bad" hint="Pick" />);
    const select = screen.getByLabelText('Theme');
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
  });
});
