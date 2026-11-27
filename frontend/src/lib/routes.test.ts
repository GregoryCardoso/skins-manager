import { describe, expect, test } from 'vitest';
import { activeNavId, NAV_ITEMS, SETTINGS_ITEM } from './routes';

describe('activeNavId (12.4)', () => {
  test('a raiz só vale exata', () => {
    expect(activeNavId('/')).toBe('inventory');
    expect(activeNavId('')).toBe('inventory');
    expect(activeNavId(null)).toBe('inventory');
    expect(activeNavId('/inventory')).toBeNull();
  });

  test('cada rota, com e sem a barra final, e subcaminhos', () => {
    for (const item of [...NAV_ITEMS, SETTINGS_ITEM].filter((entry) => entry.id !== 'inventory')) {
      const base = item.href.replace(/\/$/, '');
      expect(activeNavId(base)).toBe(item.id);
      expect(activeNavId(`${base}/`)).toBe(item.id);
      expect(activeNavId(`${base}/algo`)).toBe(item.id);
      expect(activeNavId(`${base}x`)).toBeNull();
    }
  });

  test('desconhecida dá null e a consulta é ignorada', () => {
    expect(activeNavId('/nada/')).toBeNull();
    expect(activeNavId('/sales/?status=VENDIDO')).toBe('sales');
  });

  test('o menu tem os cinco itens na ordem e Importações está entre eles', () => {
    expect(NAV_ITEMS.map((item) => item.id)).toEqual(['inventory', 'sales', 'profit', 'stores', 'imports']);
    expect(SETTINGS_ITEM.id).toBe('settings');
  });
});
