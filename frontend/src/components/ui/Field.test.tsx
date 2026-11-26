// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderUi } from '@/test/renderUi';
import Field from './Field';
import FormErrorSummary from './FormErrorSummary';
import TextField from './TextField';

afterEach(cleanup);

describe('Field', () => {
  test('aria-describedby aponta para a dica e para o erro; aria-invalid', () => {
    renderUi(
      <Field label="Name" hint="Visible name" error="Required" name="name">
        {(control) => <input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('data-field', 'name');
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0])).toHaveTextContent('Visible name');
    expect(document.getElementById(ids[1])).toHaveTextContent('Required');
  });

  test('o erro não usa role=alert', () => {
    renderUi(<Field label="Name" error="Required">{(control) => <input {...control} />}</Field>);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('sem dica nem erro: sem aria-describedby; optional e required', () => {
    renderUi(
      <>
        <Field label="A" optional>{(control) => <input {...control} />}</Field>
        <Field label="B" required>{(control) => <input {...control} />}</Field>
      </>,
    );
    expect(screen.getByLabelText(/^A/)).not.toHaveAttribute('aria-describedby');
    expect(screen.getByText('(optional)')).toBeInTheDocument();
    expect(screen.getByLabelText(/^B/)).toHaveAttribute('aria-required', 'true');
  });
});

describe('TextField', () => {
  function Wrapper({ onChange }: { onChange?: (v: string) => void }) {
    const [value, setValue] = useState('');
    return (
      <TextField
        label="Search"
        type="search"
        leadingIcon="search"
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
      />
    );
  }

  test('digitar chama onChange; busca é type=search', async () => {
    const onChange = vi.fn();
    renderUi(<Wrapper onChange={onChange} />);
    const input = screen.getByRole('searchbox', { name: 'Search' });
    await userEvent.type(input, 'ak');
    expect(onChange).toHaveBeenLastCalledWith('ak');
    expect(input).toHaveValue('ak');
  });

  test('desabilitado e erro', () => {
    renderUi(<TextField label="Name" value="" onChange={() => {}} disabled error="Bad" />);
    const input = screen.getByLabelText('Name');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('FormErrorSummary', () => {
  test('recebe o foco ao montar e o clique foca o campo', async () => {
    renderUi(
      <>
        <TextField label="Price" name="price" value="" onChange={() => {}} />
        <FormErrorSummary errors={[{ field: 'price', label: 'Price', message: 'Invalid amount' }]} />
      </>,
    );
    const summary = screen.getByRole('alert');
    expect(summary).toHaveFocus();
    expect(summary).toHaveTextContent('Check 1 field');
    await userEvent.click(screen.getByRole('button', { name: /Price: Invalid amount/ }));
    expect(screen.getByLabelText('Price')).toHaveFocus();
  });

  test('plural: 2 campos; sem erros não renderiza', () => {
    const { rerender } = renderUi(
      <FormErrorSummary
        errors={[
          { field: 'a', label: 'A', message: 'x' },
          { field: 'b', label: 'B', message: 'y' },
        ]}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Check 2 fields');
    rerender(<FormErrorSummary errors={[]} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
