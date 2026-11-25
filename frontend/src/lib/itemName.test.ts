import { describe, expect, test } from 'vitest';
import { englishNameTitle, itemDisplayName, itemEnglishTitle, localizedOrName } from './itemName';

describe('itemName (11.5, D369)', () => {
  test('usa o nome traduzido; sem tradução ou em branco, o inglês', () => {
    expect(localizedOrName('AK-47 | Redline', 'AK-47 | Linha Vermelha')).toBe('AK-47 | Linha Vermelha');
    expect(localizedOrName('AK-47 | Redline', null)).toBe('AK-47 | Redline');
    expect(localizedOrName('AK-47 | Redline', undefined)).toBe('AK-47 | Redline');
    expect(localizedOrName('AK-47 | Redline', '   ')).toBe('AK-47 | Redline');
  });

  test('itemDisplayName lê catalog.localizedName; item legado (sem catálogo) mostra o nome gravado', () => {
    expect(itemDisplayName({ name: 'Glock-18 | Fade', catalog: { localizedName: 'Glock-18 | Fade PT' } })).toBe('Glock-18 | Fade PT');
    expect(itemDisplayName({ name: 'Glock-18 | Fade', catalog: { localizedName: null } })).toBe('Glock-18 | Fade');
    expect(itemDisplayName({ name: 'Item antigo', catalog: null })).toBe('Item antigo');
    expect(itemDisplayName({ name: 'Item antigo' })).toBe('Item antigo');
  });

  test('o title com o nome em inglês só aparece quando o exibido é a tradução', () => {
    expect(itemEnglishTitle({ name: 'AWP | Asiimov', catalog: { localizedName: 'AWP | Asiimov (tr)' } })).toBe('AWP | Asiimov');
    expect(itemEnglishTitle({ name: 'AWP | Asiimov', catalog: { localizedName: null } })).toBeUndefined();
    expect(itemEnglishTitle({ name: 'AWP | Asiimov', catalog: null })).toBeUndefined();
    expect(englishNameTitle('X', 'X')).toBeUndefined();
    expect(englishNameTitle('X', 'Y')).toBe('X');
  });
});
