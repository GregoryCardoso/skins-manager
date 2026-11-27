// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderUi } from '@/test/renderUi';
import type { Store } from '@/types/api';
import StoreCard from './StoreCard';

const store = (extra: Partial<Store> = {}): Store => ({
  id: 7, name: 'CSFloat', currency: 'USD', isActive: true, isPrimary: false, saleFeeType: 'DEDUCTED', saleFeeRate: 0.02,
  saleFeeRounding: 'CEIL', saleMinFeeCents: 3, saleFixedFeeCents: 0, allowsWithdrawal: true, withdrawalFeeRate: 0.01,
  withdrawalFixedFeeCents: 0, saleHoldDays: 7, createdAt: '', updatedAt: '', saleFeesConfigured: true, inUse: false, ...extra,
});

const handlers = () => ({ onEdit: vi.fn(), onToggleActive: vi.fn(), onMakePrimary: vi.fn(), onToggleSteam: vi.fn(), onDelete: vi.fn() });

afterEach(cleanup);

describe('StoreCard', () => {
  test('mostra o nome, a moeda e as taxas numa frase, com a retenção e o saque', () => {
    renderUi(<StoreCard store={store()} busy={false} {...handlers()} />);
    expect(screen.getByRole('heading', { name: 'CSFloat' })).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getByText('2% deducted from the price · minimum $0.03')).toBeInTheDocument();
    expect(screen.getByText('Round up')).toBeInTheDocument();
    expect(screen.getByText('7 days')).toBeInTheDocument();
    expect(screen.getByText('Yes, 1%')).toBeInTheDocument();
  });

  test('os selos têm texto (nunca só cor): ativa, principal e a Steam', () => {
    renderUi(<StoreCard store={store({ isPrimary: true, isSteamStore: true })} busy={false} {...handlers()} />);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('Your Steam')).toBeInTheDocument();
  });

  test('loja inativa mostra "Inactive"; taxa não configurada mostra o aviso e esconde o arredondamento', () => {
    renderUi(<StoreCard store={store({ isActive: false, saleFeeType: null, saleFeeRate: null })} busy={false} {...handlers()} />);
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByText('no sale fee set')).toBeInTheDocument();
    expect(screen.queryByText('Round up')).toBeNull();
  });

  test('Editar chama onEdit com a loja; busy desabilita Editar e o menu', async () => {
    const h = handlers();
    const { rerender } = renderUi(<StoreCard store={store()} busy={false} {...h} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(h.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
    rerender(<StoreCard store={store()} busy {...h} />);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'More actions for CSFloat' })).toBeDisabled();
  });

  test('o menu "Mais ações" traz as ações; a principal mostra o motivo de cada indisponível', async () => {
    renderUi(<StoreCard store={store({ isPrimary: true })} busy={false} {...handlers()} />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions for CSFloat' }));
    const menu = await screen.findByRole('menu');
    const make = within(menu).getByRole('menuitem', { name: /Make primary/ });
    expect(make).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).getByText('Already the primary store.')).toBeVisible();
    const del = within(menu).getByRole('menuitem', { name: /Delete/ });
    expect(del).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).getAllByText('Choose another primary store first.').length).toBeGreaterThanOrEqual(1);
  });

  test('ações disponíveis chamam os tratadores (ativar/desativar, Steam e excluir)', async () => {
    const h = handlers();
    renderUi(<StoreCard store={store()} busy={false} {...h} />);
    const open = async () => userEvent.click(screen.getByRole('button', { name: 'More actions for CSFloat' }));
    await open();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Deactivate' }));
    expect(h.onToggleActive).toHaveBeenCalledTimes(1);
    await open();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Use as my Steam store' }));
    expect(h.onToggleSteam).toHaveBeenCalledTimes(1);
    await open();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(h.onDelete).toHaveBeenCalledTimes(1);
  });

  test('a loja Steam oferece "Stop using as my Steam store"; em uso mostra o motivo na exclusão', async () => {
    renderUi(<StoreCard store={store({ isSteamStore: true, inUse: true })} busy={false} {...handlers()} />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions for CSFloat' }));
    expect(await screen.findByRole('menuitem', { name: 'Stop using as my Steam store' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Delete/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('The store has already been used. It can only be deactivated.')).toBeVisible();
  });
});
