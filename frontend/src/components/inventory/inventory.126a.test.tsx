// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeItem } from '@/lib/testFixtures';
import { renderUi } from '@/test/renderUi';
import ItemRowActions, { type UnitRowHandlers } from './ItemRowActions';

afterEach(cleanup);

const handlers = (extra: Partial<UnitRowHandlers> = {}): UnitRowHandlers => ({
  onEdit: vi.fn(), onSell: vi.fn(), onUnsell: vi.fn(), onDelete: vi.fn(), onHistory: vi.fn(), onOffSale: vi.fn(), onForSale: vi.fn(), ...extra,
});

describe('entrada "Componentes" no menu da linha (12.6a)', () => {
  test('aparece logo depois de Editar e chama onComponents com a unidade', async () => {
    const onComponents = vi.fn();
    const item = makeItem();
    renderUi(<ItemRowActions item={item} handlers={handlers({ onComponents })} />);
    await userEvent.click(screen.getByRole('button', { name: /More actions/ }));
    const entries = (await screen.findAllByRole('menuitem')).map((entry) => entry.textContent);
    expect(entries.slice(0, 2)).toEqual(['Edit', 'Components']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Components' }));
    expect(onComponents).toHaveBeenCalledWith(item);
  });

  test('sem o manipulador (página de vendas) a entrada não aparece', async () => {
    renderUi(<ItemRowActions item={makeItem()} handlers={handlers()} />);
    await userEvent.click(screen.getByRole('button', { name: /More actions/ }));
    await screen.findAllByRole('menuitem');
    expect(screen.queryByRole('menuitem', { name: 'Components' })).toBeNull();
  });
});
