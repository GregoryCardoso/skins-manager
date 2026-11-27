// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { focusSteamChoice } from './storeSummary';

// Monta cartões com `data-store-id` e o botão de menu `data-store-menu` (o que o StoreCard renderiza).
function mount(ids: number[], withMenu: (id: number) => boolean = () => true): HTMLElement {
  const root = document.createElement('div');
  for (const id of ids) {
    const card = document.createElement('article');
    card.setAttribute('data-store-id', String(id));
    if (withMenu(id)) {
      const menu = document.createElement('button');
      menu.setAttribute('data-store-menu', '');
      menu.textContent = `menu ${id}`;
      card.appendChild(menu);
    }
    root.appendChild(card);
  }
  document.body.appendChild(root);
  return root;
}
const menuOf = (root: HTMLElement, id: number) => root.querySelector<HTMLElement>(`[data-store-id="${id}"] [data-store-menu]`)!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('focusSteamChoice', () => {
  test('foca o menu do cartão cujo nome tem "steam" (sem diferenciar maiúsculas)', () => {
    const root = mount([1, 2, 3]);
    focusSteamChoice(root, [{ id: 1, name: 'CSFloat' }, { id: 2, name: 'Minha STEAM' }, { id: 3, name: 'Outra' }]);
    expect(document.activeElement).toBe(menuOf(root, 2));
  });
  test('sem loja com "steam" no nome: foca o primeiro cartão', () => {
    const root = mount([5, 6]);
    focusSteamChoice(root, [{ id: 5, name: 'A' }, { id: 6, name: 'B' }]);
    expect(document.activeElement).toBe(menuOf(root, 5));
  });
  test('lista vazia: não faz nada e não lança', () => {
    const root = mount([]);
    expect(() => focusSteamChoice(root, [])).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });
  test('cartão ausente do DOM ou sem menu: não lança e o foco não muda', () => {
    const root = mount([1], () => false);
    expect(() => focusSteamChoice(root, [{ id: 1, name: 'Steam' }])).not.toThrow();
    expect(() => focusSteamChoice(root, [{ id: 99, name: 'Steam' }])).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });
  test('o id de outro cartão com o mesmo prefixo não é confundido (id 1 x 10)', () => {
    const root = mount([10, 1]);
    focusSteamChoice(root, [{ id: 1, name: 'Steam' }, { id: 10, name: 'X' }]);
    expect(document.activeElement).toBe(menuOf(root, 1));
  });
});
