import { describe, expect, test } from 'vitest';
import en from './en.json';
import ptBR from './pt-BR.json';

// 10.6 (D365): todo motivo do tipo tem texto nos dois idiomas, e os dois idiomas têm as mesmas chaves novas.
const REASONS = ['NO_EXTERIOR', 'PHASE_REQUIRED', 'PHASE_UNMAPPED', 'NOT_PRICEABLE', 'NOT_FETCHED', 'NOT_FOUND', 'NOT_FETCHED_NO_KEY'];
const NET = ['NO_INTEGRATION_STORE', 'FEES_NOT_CONFIGURED', 'NET_NOT_COMPUTABLE', 'GROUP'];

const keysOf = (node: unknown, prefix = ''): string[] =>
  node !== null && typeof node === 'object'
    ? Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k))
    : [prefix];

describe('i18n do valor de mercado', () => {
  test.each([['pt-BR', ptBR], ['en', en]])('%s tem os motivos e os textos novos', (_name, messages) => {
    const mv = (messages as { inventory: { marketValue: { reason: Record<string, string>; netUnavailable: Record<string, string> } } }).inventory.marketValue;
    for (const r of REASONS) expect(mv.reason[r], r).toBeTruthy();
    for (const r of NET) expect(mv.netUnavailable[r], r).toBeTruthy();
  });
  test('paridade das chaves novas', () => {
    const pick = (m: unknown) => keysOf(m).filter((k) => /marketValue|^prices\.|common\.ago|profit\.market|columns\.(marketValue|unrealized)/.test(k)).sort();
    expect(pick(en)).toEqual(pick(ptBR));
  });
  test('a coluna e o card se chamam PnL não realizado', () => {
    expect(ptBR.inventory.columns.unrealized).toContain('PnL não realizado');
    expect(en.profit.market.pnlLabel).toBe('Unrealized PnL');
    expect(en.profit.market.valueLabel).toBe('Current market value of inventory');
  });
});
