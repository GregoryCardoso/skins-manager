// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { renderUi } from '@/test/renderUi';
import FormErrorSummary from './FormErrorSummary';

afterEach(cleanup);

const item = (field: string, message = `erro em ${field}`) => ({ field, label: field, message });

describe('FormErrorSummary: foco', () => {
  test('ao montar com erros, recebe o foco', async () => {
    renderUi(<FormErrorSummary errors={[item('a'), item('b')]} />);
    expect(screen.getByRole('alert')).toHaveFocus();
  });

  test('corrigir um dos erros não tira o foco de quem está digitando; um erro novo traz o foco de volta', async () => {
    const { rerender } = renderUi(
      <>
        <input aria-label="campo" />
        <FormErrorSummary errors={[item('a'), item('b')]} />
      </>,
    );
    await userEvent.click(screen.getByLabelText('campo'));
    rerender(
      <>
        <input aria-label="campo" />
        <FormErrorSummary errors={[item('b')]} />
      </>,
    );
    expect(screen.getByLabelText('campo')).toHaveFocus();
    rerender(
      <>
        <input aria-label="campo" />
        <FormErrorSummary errors={[item('b'), item('c')]} />
      </>,
    );
    expect(screen.getByRole('alert')).toHaveFocus();
  });
});
