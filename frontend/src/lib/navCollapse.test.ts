import { describe, expect, test } from 'vitest';
import { NAV_COLLAPSED_STORAGE_KEY, readNavCollapsed, writeNavCollapsed } from './navCollapse';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => (k in data ? data[k] : null), setItem: (k: string, v: string) => { data[k] = v; } };
}
const throwing = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };

describe('navCollapse (12.4)', () => {
  test('lê 1 como recolhido e qualquer outra coisa como expandido', () => {
    expect(readNavCollapsed(fakeStorage({ [NAV_COLLAPSED_STORAGE_KEY]: '1' }))).toBe(true);
    for (const value of ['0', '', 'true', 'yes']) expect(readNavCollapsed(fakeStorage({ [NAV_COLLAPSED_STORAGE_KEY]: value }))).toBe(false);
    expect(readNavCollapsed(fakeStorage())).toBe(false);
  });

  test('grava 1 e 0 na chave sm.navCollapsed', () => {
    const storage = fakeStorage();
    writeNavCollapsed(true, storage);
    expect(storage.data['sm.navCollapsed']).toBe('1');
    writeNavCollapsed(false, storage);
    expect(storage.data['sm.navCollapsed']).toBe('0');
  });

  test('storage indisponível ou que lança nunca quebra', () => {
    expect(readNavCollapsed(null)).toBe(false);
    expect(readNavCollapsed(throwing)).toBe(false);
    expect(() => writeNavCollapsed(true, null)).not.toThrow();
    expect(() => writeNavCollapsed(true, throwing)).not.toThrow();
  });
});
