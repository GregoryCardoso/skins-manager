import { describe, expect, test } from 'vitest';
import { getDesktopBridge } from './desktop';

describe('getDesktopBridge', () => {
  test('sem window.skinsDesktop devolve null', () => {
    expect(getDesktopBridge({})).toBeNull();
    expect(getDesktopBridge(undefined)).toBeNull();
  });
  test('ponte incompleta devolve null', () => {
    expect(getDesktopBridge({ skinsDesktop: { isDesktop: true } })).toBeNull();
  });
  test('ponte completa', () => {
    const bridge = { isDesktop: true, getAppInfo: () => Promise.resolve({}), checkForUpdates: () => Promise.resolve({}) };
    expect(getDesktopBridge({ skinsDesktop: bridge })).toBe(bridge);
  });
});
