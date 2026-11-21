import { describe, expect, test } from 'vitest';
import { getDesktopBridge } from './desktop';

const fn = () => Promise.resolve({});

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

describe('getDesktopBridge: casos extras', () => {
  test('window ausente ou de tipo errado', () => {
    expect(getDesktopBridge(null)).toBeNull();
    expect(getDesktopBridge('texto')).toBeNull();
    expect(getDesktopBridge(42)).toBeNull();
  });
  test('sem skinsDesktop no objeto window', () => {
    expect(getDesktopBridge({ document: {} })).toBeNull();
    expect(getDesktopBridge({ skinsDesktop: null })).toBeNull();
    expect(getDesktopBridge({ skinsDesktop: 'x' })).toBeNull();
  });
  test('isDesktop precisa ser exatamente true', () => {
    for (const isDesktop of [false, 'true', 1, undefined]) {
      expect(getDesktopBridge({ skinsDesktop: { isDesktop, getAppInfo: fn, checkForUpdates: fn } })).toBeNull();
    }
  });
  test('falta checkForUpdates ou getAppInfo (preload antigo)', () => {
    expect(getDesktopBridge({ skinsDesktop: { isDesktop: true, getAppInfo: fn } })).toBeNull();
    expect(getDesktopBridge({ skinsDesktop: { isDesktop: true, checkForUpdates: fn } })).toBeNull();
    expect(getDesktopBridge({ skinsDesktop: { isDesktop: true, getAppInfo: 'x', checkForUpdates: 'y' } })).toBeNull();
  });
  test('sem argumento, no ambiente node (sem window) devolve null', () => {
    expect(getDesktopBridge()).toBeNull();
  });
});
