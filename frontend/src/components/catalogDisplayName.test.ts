import { describe, expect, test } from 'vitest';
import { catalogDisplayName } from './CatalogAutocomplete';

// 11.5 (D369): o nome vem do backend já no idioma das configurações (`localizedName`); sem tradução, cai no inglês.
describe('catalogDisplayName', () => {
  test('usa localizedName quando existe e cai no nome em inglês quando é nulo', () => {
    expect(catalogDisplayName({ name: 'AK-47 | Redline', localizedName: 'AK-47 | Linha Vermelha' })).toBe('AK-47 | Linha Vermelha');
    expect(catalogDisplayName({ name: 'AK-47 | Redline', localizedName: null })).toBe('AK-47 | Redline');
  });
});
