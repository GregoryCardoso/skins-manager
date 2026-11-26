// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderUi } from '@/test/renderUi';
import Badge, { HoldingBadge, StuckBadge, TradeLockBadge } from './Badge';
import Chip from './Chip';
import SegmentedControl from './SegmentedControl';

afterEach(cleanup);

type View = 'grouped' | 'individual' | 'cards';
const OPTIONS: { value: View; label: string }[] = [
  { value: 'grouped', label: 'Grouped' },
  { value: 'individual', label: 'Individual' },
  { value: 'cards', label: 'Cards' },
];

function Wrapper({ onChange }: { onChange?: (v: View) => void }) {
  const [value, setValue] = useState<View>('grouped');
  return (
    <>
      <button type="button">before</button>
      <SegmentedControl
        label="View"
        value={value}
        options={OPTIONS}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
      />
      <button type="button">after</button>
    </>
  );
}

describe('SegmentedControl', () => {
  test('o grupo tem nome; o ativo está marcado (ARIA que o Radix gera: radio com aria-checked)', () => {
    renderUi(<Wrapper />);
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Grouped' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Individual' })).toHaveAttribute('aria-checked', 'false');
  });

  test('um único ponto de Tab; setas mudam o valor', async () => {
    const onChange = vi.fn();
    renderUi(<Wrapper onChange={onChange} />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'before' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('radio', { name: 'Grouped' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Individual' })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('individual');
    expect(screen.getByRole('radio', { name: 'Individual' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus();
  });

  test('clicar numa opção seleciona uma vez; clicar no ativo não deixa vazio', async () => {
    const onChange = vi.fn();
    renderUi(<Wrapper onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Cards' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('radio', { name: 'Cards' }));
    expect(screen.getByRole('radio', { name: 'Cards' })).toHaveAttribute('aria-checked', 'true');
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('Chip', () => {
  test('aria-pressed alterna e mostra o ícone check', async () => {
    const onChange = vi.fn();
    function Chips() {
      const [on, setOn] = useState(false);
      return (
        <Chip
          pressed={on}
          count={3}
          tone="stuck"
          onPressedChange={(p) => {
            setOn(p);
            onChange(p);
          }}
        >
          Only stuck
        </Chip>
      );
    }
    const { container } = renderUi(<Chips />);
    const chip = screen.getByRole('button', { name: /Only stuck/ });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(container.querySelector('svg')).toBeNull();
    await userEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test('desabilitado', () => {
    renderUi(<Chip pressed={false} onPressedChange={() => {}} disabled>Off</Chip>);
    expect(screen.getByRole('button', { name: 'Off' })).toBeDisabled();
  });
});

describe('Badge', () => {
  test('o texto está presente e o ícone é aria-hidden', () => {
    const { container } = renderUi(<Badge tone="lock" icon="lock">Locked</Badge>);
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  test('atalhos usam os textos dos dicionários', () => {
    renderUi(
      <>
        <TradeLockBadge remainingText="3 d" />
        <HoldingBadge sinceText="2 d" />
        <StuckBadge />
      </>,
    );
    expect(screen.getByText('In trade lock · 3 d')).toBeInTheDocument();
    expect(screen.getByText('Holding · 2 d')).toBeInTheDocument();
    expect(screen.getByText('Stuck')).toBeInTheDocument();
  });
});
