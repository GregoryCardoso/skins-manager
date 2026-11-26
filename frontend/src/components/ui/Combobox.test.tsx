// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { CURRENCY_GROUP_IDS, CURRENCY_PINNED, currencyComboboxOptions } from '@/lib/currencies';
import { loadMessages, renderUi } from '@/test/renderUi';
import type { Language } from '@/types/api';
import Combobox, { type ComboboxOption, type ComboboxProps } from './Combobox';

afterEach(cleanup);

const FRUITS: ComboboxOption[] = [
  { value: 'apple', label: 'Apple', group: 'a' },
  { value: 'avocado', label: 'Avocado', group: 'a', disabled: true },
  { value: 'banana', label: 'Banana', group: 'b' },
  { value: 'cherry', label: 'Cherry', group: 'b' },
];

type Extra = Partial<Omit<ComboboxProps, 'value' | 'onChange' | 'options' | 'label'>> & { options?: ComboboxOption[]; initial?: string | null; language?: Language };

function Wrapper({ options = FRUITS, initial = null, onPick, ...rest }: Extra & { onPick?: (v: string | null) => void }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <Combobox
      label="Fruit"
      value={value}
      options={options}
      onChange={(v) => {
        setValue(v);
        onPick?.(v);
      }}
      {...rest}
    />
  );
}

async function setup(extra: Extra & { onPick?: (v: string | null) => void } = {}) {
  const language = extra.language ?? 'en';
  renderUi(<Wrapper {...extra} />, { language, messages: language === 'en' ? undefined : await loadMessages(language) });
  return screen.getByRole('combobox', { name: 'Fruit' });
}

describe('Combobox', () => {
  test('ARIA: combobox com listbox; fechada tem aria-expanded=false', async () => {
    const input = await setup();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    await userEvent.click(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox', { name: 'Fruit' })).toBeInTheDocument();
    expect(input.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id);
  });

  test('abre com ↓, pula desabilitada, Enter escolhe', async () => {
    const onPick = vi.fn();
    const input = await setup({ onPick });
    input.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    // primeira habilitada ativa: Apple
    const active = () => document.getElementById(input.getAttribute('aria-activedescendant') ?? '');
    expect(active()).toHaveTextContent('Apple');
    await userEvent.keyboard('{ArrowDown}');
    expect(active()).toHaveTextContent('Banana');
    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('banana');
    expect(input).toHaveValue('Banana');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  test('Alt+↓ abre; Esc fecha; com a lista fechada, Esc volta ao valor escolhido', async () => {
    const input = await setup({ initial: 'cherry' });
    input.focus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await userEvent.clear(input);
    await userEvent.type(input, 'ban');
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Escape}');
    expect(input).toHaveValue('Cherry');
  });

  test('aria-selected na opção do valor atual', async () => {
    const input = await setup({ initial: 'banana' });
    await userEvent.click(input);
    expect(screen.getByRole('option', { name: /Banana/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /Cherry/ })).toHaveAttribute('aria-selected', 'false');
  });

  test('Tab com texto livre restaura o rótulo do valor atual', async () => {
    const input = await setup({ initial: 'apple' });
    await userEvent.clear(input);
    await userEvent.type(input, 'xyzzy');
    await userEvent.tab();
    expect(input).toHaveValue('Apple');
  });

  test('clique numa opção escolhe sem tirar o foco do input', async () => {
    const onPick = vi.fn();
    const input = await setup({ onPick });
    await userEvent.click(input);
    await userEvent.click(screen.getByRole('option', { name: /Cherry/ }));
    expect(onPick).toHaveBeenCalledWith('cherry');
    expect(input).toHaveFocus();
  });

  test('filtra sem acento e sem caixa; sem resultado avisa na região viva', async () => {
    const input = await setup({ options: [{ value: 'acai', label: 'Açaí' }, { value: 'b', label: 'Berry' }] });
    await userEvent.type(input, 'ACAI');
    expect(screen.getByRole('option', { name: /Açaí/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Berry/ })).toBeNull();
    expect(screen.getByText('1 result', { selector: '[role="status"]' })).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'zzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getAllByText('No results for "zzz"').length).toBeGreaterThan(0);
  });

  test('filter="none" não filtra; onInputChange avisa o chamador', async () => {
    const onInputChange = vi.fn();
    const input = await setup({ filter: 'none', onInputChange });
    await userEvent.type(input, 'zz');
    expect(onInputChange).toHaveBeenLastCalledWith('zz');
    expect(screen.getAllByRole('option')).toHaveLength(FRUITS.length);
  });

  test('pinned: no topo, sem duplicar', async () => {
    const input = await setup({ pinned: ['cherry'], groups: [{ id: 'a', label: 'Group A' }, { id: 'b', label: 'Group B' }] });
    await userEvent.click(input);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options[0]).toContain('Cherry');
    expect(options.filter((text) => text?.includes('Cherry'))).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Most used' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Group A' })).toBeInTheDocument();
  });

  test('clearable limpa o valor', async () => {
    const onPick = vi.fn();
    await setup({ initial: 'apple', clearable: true, onPick });
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onPick).toHaveBeenLastCalledWith(null);
  });

  test('loading marca a lista com aria-busy', async () => {
    const input = await setup({ loading: true, options: [] });
    await userEvent.click(input);
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});

describe('Combobox de moedas', () => {
  async function currencySetup(language: Language) {
    const options = currencyComboboxOptions(language === 'pt-BR' ? 'pt-BR' : language);
    renderUi(
      <Wrapper
        options={options as ComboboxOption[]}
        pinned={[...CURRENCY_PINNED]}
        groups={CURRENCY_GROUP_IDS.map((id) => ({ id, label: id }))}
      />,
      { language, messages: language === 'en' ? undefined : await loadMessages(language) },
    );
    return screen.getByRole('combobox', { name: 'Fruit' });
  }

  test('"real" e "brl" acham BRL', async () => {
    const input = await currencySetup('pt-BR');
    await userEvent.type(input, 'real');
    expect(screen.getAllByRole('option').some((o) => /BRL/.test(o.textContent ?? ''))).toBe(true);
    await userEvent.clear(input);
    await userEvent.type(input, 'brl');
    expect(screen.getAllByRole('option').some((o) => /BRL/.test(o.textContent ?? ''))).toBe(true);
  });

  test('"Lira" em tr acha TRY', async () => {
    const input = await currencySetup('tr');
    await userEvent.type(input, 'Lira');
    await waitFor(() => expect(screen.getAllByRole('option').some((o) => /TRY/.test(o.textContent ?? ''))).toBe(true));
  });

  test('"円" em ja acha JPY', async () => {
    const input = await currencySetup('ja');
    await userEvent.type(input, '円');
    expect(screen.getAllByRole('option').some((o) => /JPY/.test(o.textContent ?? ''))).toBe(true);
  });

  test('USD, BRL e EUR no topo, uma vez cada', async () => {
    const input = await currencySetup('en');
    await userEvent.click(input);
    const texts = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(texts).toHaveLength(42);
    expect(texts.slice(0, 3).map((x) => x.slice(0, 3))).toEqual(['USD', 'BRL', 'EUR']);
  });
});
