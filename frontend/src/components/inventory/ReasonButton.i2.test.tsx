// @vitest-environment jsdom
import '@/test/setupDom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeItem } from '@/lib/testFixtures';
import { renderUi } from '@/test/renderUi';
import ItemRowActions, { type UnitRowHandlers } from './ItemRowActions';
import SelectionBar from './SelectionBar';

afterEach(cleanup);

const handlers = (): UnitRowHandlers => ({
  onEdit: vi.fn(), onSell: vi.fn(), onUnsell: vi.fn(), onDelete: vi.fn(), onHistory: vi.fn(), onOffSale: vi.fn(), onForSale: vi.fn(),
});

describe('motivo do botão desativado (12.12, I2)', () => {
  test('Vender em trade lock: aria-disabled, motivo ligado por aria-describedby e clique ignorado', async () => {
    const onSell = vi.fn();
    const item = makeItem({ tradeLock: { isLocked: true, remainingMs: 86_400_000, formatted: '1d', tradeUnlockAt: '2026-12-01T10:00:00.000Z' } });
    renderUi(<ItemRowActions item={item} handlers={{ ...handlers(), onSell }} />);
    const sell = screen.getByRole('button', { name: 'Sell' });
    expect(sell).toHaveAttribute('aria-disabled', 'true');
    const describedBy = sell.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toMatch(/Trade locked until/);
    expect(sell).toHaveAccessibleDescription(/Trade locked until/);
    await userEvent.click(sell);
    expect(onSell).not.toHaveBeenCalled();
  });

  test('Vender liberado: sem descrição e o clique funciona', async () => {
    const onSell = vi.fn();
    renderUi(<ItemRowActions item={makeItem()} handlers={{ ...handlers(), onSell }} />);
    const sell = screen.getByRole('button', { name: 'Sell' });
    expect(sell).not.toHaveAttribute('aria-disabled');
    expect(sell).not.toHaveAttribute('aria-describedby');
    await userEvent.click(sell);
    expect(onSell).toHaveBeenCalledTimes(1);
  });

  test('o motivo aparece na dica ao focar o botão desativado (sem depender do mouse)', async () => {
    const item = makeItem({ tradeLock: { isLocked: true, remainingMs: 86_400_000, formatted: '1d', tradeUnlockAt: '2026-12-01T10:00:00.000Z' } });
    renderUi(<ItemRowActions item={item} handlers={handlers()} />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Sell' })).toHaveFocus();
    expect((await screen.findAllByText(/Trade locked until/)).length).toBeGreaterThan(0);
  });

  test('SelectionBar acima do limite: o botão aponta para o aviso visível', () => {
    renderUi(<SelectionBar count={501} direction="OFF_SALE" onMove={vi.fn()} onClear={vi.fn()} />);
    const move = screen.getAllByRole('button').find((b) => b.getAttribute('aria-disabled') === 'true');
    expect(move).toBeDefined();
    expect(move).toHaveAccessibleDescription(/Up to 500 units/);
  });
});

describe('aparência de desativado (12.12, I2 e M4)', () => {
  const read = (file: string) => readFileSync(path.join(__dirname, '..', 'ui', file), 'utf8');

  test.each(['Button.module.css', 'IconButton.module.css'])('%s: aria-disabled sem carregando tem a aparência de desativado, sem opacidade', (file) => {
    const css = read(file);
    expect(css).toMatch(/aria-disabled='true'\]:not\(/);
    expect(css).toMatch(/not-allowed/);
    expect(css).not.toMatch(/opacity:\s*0?\.55/);
  });

  test('cursor progress só no carregando', () => {
    const css = read('Button.module.css');
    expect(css).toMatch(/\.button\.loading\s*\{\s*cursor:\s*progress/);
    expect(css).not.toMatch(/\.button\[aria-disabled='true'\]\s*\{\s*cursor:\s*progress/);
  });

  test('Chip desativado usa o texto --muted (contraste), não opacidade', () => {
    expect(read('Chip.module.css')).not.toMatch(/opacity:\s*0?\.55/);
  });
});
