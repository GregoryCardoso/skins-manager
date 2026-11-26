// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CurrencyCode } from '@/lib/currencies';
import { loadMessages, renderUi } from '@/test/renderUi';
import type { Language } from '@/types/api';
import NumberField, { type NumberKind } from './NumberField';

afterEach(cleanup);

interface Props {
  kind?: NumberKind;
  currency?: CurrencyCode;
  initial?: string;
  error?: string | null;
  onParsed?: (parsed: number | null) => void;
}

function Wrapper({ kind = 'money', currency = 'USD', initial = '', error, onParsed }: Props) {
  const [text, setText] = useState(initial);
  return (
    <NumberField
      label="Amount"
      kind={kind}
      currency={kind === 'money' ? currency : undefined}
      value={text}
      error={error}
      onValueChange={(next, parsed) => {
        setText(next);
        onParsed?.(parsed);
      }}
    />
  );
}

async function setup(props: Props, language: Language = 'en') {
  const messages = language === 'en' ? undefined : await loadMessages(language);
  renderUi(<Wrapper {...props} />, { language, messages });
  return screen.getByLabelText('Amount');
}

describe('NumberField', () => {
  test('en: "1,234.56" vira 123456 centavos', async () => {
    const onParsed = vi.fn();
    const input = await setup({ onParsed });
    await userEvent.type(input, '1,234.56');
    expect(onParsed).toHaveBeenLastCalledWith(123456);
  });

  test('pt-BR: "1.234,56" vira 123456 centavos', async () => {
    const onParsed = vi.fn();
    const input = await setup({ onParsed }, 'pt-BR');
    await userEvent.type(input, '1.234,56');
    expect(onParsed).toHaveBeenLastCalledWith(123456);
  });

  test('JPY: "1500" vira 150000; "15,5" só dá erro depois do blur', async () => {
    const onParsed = vi.fn();
    const input = await setup({ currency: 'JPY', onParsed });
    await userEvent.type(input, '1500');
    expect(onParsed).toHaveBeenLastCalledWith(150000);
    await userEvent.clear(input);
    await userEvent.type(input, '15,5');
    expect(onParsed).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText(/no decimal places/)).toBeNull();
    await userEvent.tab();
    expect(await screen.findByText(/JPY has no decimal places/)).toBeInTheDocument();
    // depois do primeiro blur o erro acompanha a digitação
    await userEvent.clear(input);
    await userEvent.type(input, '15');
    expect(screen.queryByText(/JPY has no decimal places: use/)).toBeNull();
  });

  test('JPY mostra sempre a dica de números inteiros', async () => {
    await setup({ currency: 'JPY' });
    expect(screen.getByText(/JPY has no cents\. Type whole numbers/)).toBeInTheDocument();
  });

  test('moeda com centavos mostra o exemplo de formato', async () => {
    await setup({});
    expect(screen.getByText('Example: 1.25')).toBeInTheDocument();
  });

  test('ambíguo "1,250" em en: dois botões, o clique reescreve o campo', async () => {
    const onParsed = vi.fn();
    const input = await setup({ onParsed });
    await userEvent.type(input, '1,250');
    await userEvent.tab();
    expect(await screen.findByText(/separator in this number is ambiguous/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use 1.25' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use 1250' }));
    expect(input).toHaveValue('1250');
    expect(onParsed).toHaveBeenLastCalledWith(125000);
    expect(screen.queryByRole('button', { name: /^Use/ })).toBeNull();
  });

  test('ambíguo em moeda sem casas oferece só a leitura inteira', async () => {
    const input = await setup({ currency: 'JPY' });
    await userEvent.type(input, '1,250');
    await userEvent.tab();
    expect(await screen.findByRole('button', { name: 'Use 1250' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Use/ })).toHaveLength(1);
  });

  test('de usa a vírgula decimal; ja usa o ponto', async () => {
    const onParsed = vi.fn();
    const de = await setup({ onParsed }, 'de');
    await userEvent.type(de, '12,5');
    expect(onParsed).toHaveBeenLastCalledWith(1250);
    cleanup();
    const ja = await setup({ onParsed }, 'ja');
    await userEvent.type(ja, '12.5');
    expect(onParsed).toHaveBeenLastCalledWith(1250);
  });

  test('erro externo tem precedência sobre o local', async () => {
    const input = await setup({ error: 'Server says no' });
    await userEvent.type(input, 'abc');
    await userEvent.tab();
    expect(screen.getByText('Server says no')).toBeInTheDocument();
    expect(screen.queryByText(/Invalid amount/)).toBeNull();
  });

  test('erro de formato local em money depois do blur', async () => {
    const input = await setup({});
    await userEvent.type(input, 'abc');
    expect(screen.queryByText(/Invalid amount/)).toBeNull();
    await userEvent.tab();
    expect(await screen.findByText(/Invalid amount/)).toBeInTheDocument();
  });

  test('integer, float e decimal', async () => {
    const onParsed = vi.fn();
    const integer = await setup({ kind: 'integer', onParsed });
    await userEvent.type(integer, '42');
    expect(onParsed).toHaveBeenLastCalledWith(42);
    cleanup();
    const float = await setup({ kind: 'float', onParsed });
    await userEvent.type(float, '0.0712');
    expect(onParsed).toHaveBeenLastCalledWith(0.0712);
    cleanup();
    const decimal = await setup({ kind: 'decimal', onParsed });
    await userEvent.type(decimal, '5.4');
    expect(onParsed).toHaveBeenLastCalledWith(5.4);
  });

  test('inputMode: decimal em moeda com centavos, numeric em JPY e integer', async () => {
    const usd = await setup({});
    expect(usd).toHaveAttribute('inputmode', 'decimal');
    cleanup();
    const jpy = await setup({ currency: 'JPY' });
    expect(jpy).toHaveAttribute('inputmode', 'numeric');
  });
});
