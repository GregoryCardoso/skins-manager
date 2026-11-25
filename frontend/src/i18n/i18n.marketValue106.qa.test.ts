import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import en from './en.json';
import ptBR from './pt-BR.json';

// QA 10.6 (D365, Adendo 1): paridade e marcadores dos textos novos, e toda chave usada nos componentes novos existe nos dois idiomas.
const flatten = (node: unknown, prefix = ''): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[full] = value;
    else Object.assign(out, flatten(value, full));
  }
  return out;
};
const dicts = { 'pt-BR': flatten(ptBR), en: flatten(en) };
const SRC = path.join(__dirname, '..');
const NEW_SCOPE = /^(inventory\.marketValue\.|inventory\.columns\.(marketValue|unrealized)$|prices\.|common\.ago\.|profit\.market\.)/;
const markers = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const FILES = [
  'components/MarketValueCell.tsx', 'components/MarketValueCards.tsx', 'components/PriceStatusIndicator.tsx', 'components/PriceAutoRefreshHost.tsx',
  'components/InventoryUnitRow.tsx', 'components/InventoryTable.tsx', 'components/InventoryGroupTable.tsx', 'components/SummaryCards.tsx',
  'lib/priceStatus.ts', 'lib/marketValueDisplay.ts', 'lib/format.ts',
];

describe('textos novos do valor de mercado nos dois idiomas', () => {
  test('mesmas chaves nas duas línguas dentro do escopo novo (e o escopo não está vazio)', () => {
    const scope = (d: Record<string, string>) => Object.keys(d).filter((k) => NEW_SCOPE.test(k)).sort();
    expect(scope(dicts.en)).toEqual(scope(dicts['pt-BR']));
    expect(scope(dicts.en).length).toBeGreaterThan(50);
  });

  test('mesmos marcadores {x} em cada chave do escopo novo, e nenhum texto vazio', () => {
    for (const key of Object.keys(dicts['pt-BR']).filter((k) => NEW_SCOPE.test(k))) {
      expect(markers(dicts.en[key]), key).toEqual(markers(dicts['pt-BR'][key]));
      expect(dicts.en[key].trim(), `en ${key}`).not.toBe('');
      expect(dicts['pt-BR'][key].trim(), `pt-BR ${key}`).not.toBe('');
    }
  });

  test('plurais completos (one e other, com {count}) nos dois idiomas', () => {
    for (const [lang, dict] of Object.entries(dicts)) {
      for (const key of Object.keys(dict).filter((k) => NEW_SCOPE.test(k) && k.endsWith('.one'))) {
        const base = key.slice(0, -4);
        expect(dict[`${base}.other`], `${lang} ${base}.other`).toBeTruthy();
        expect(dict[key], `${lang} ${key}`).toContain('{count}');
        expect(dict[`${base}.other`], `${lang} ${base}.other`).toContain('{count}');
      }
      for (const base of ['inventory.marketValue.staleCount', 'profit.market.staleCount']) expect(dict[`${base}.one`] && dict[`${base}.other`], `${lang} ${base}`).toBeTruthy();
    }
  });

  test('parâmetros esperados pelo código: parts.*, gross, pricedAt, staleHint, coverage, tabSummary.*, counts, split, updatedAgo, failedTitle*', () => {
    const expected: Record<string, string[]> = {
      'inventory.marketValue.parts.item': ['value'], 'inventory.marketValue.parts.hanging': ['value'], 'inventory.marketValue.parts.stickers': ['value'],
      'inventory.marketValue.parts.patches': ['value'], 'inventory.marketValue.gross': ['value'], 'inventory.marketValue.pricedAt': ['date'],
      'inventory.marketValue.staleHint': ['date'], 'inventory.marketValue.coverage': ['priced', 'total'], 'inventory.marketValue.counts': ['notPriceable', 'unpriced'],
      'inventory.marketValue.tabSummary.forSale': ['value'], 'inventory.marketValue.tabSummary.holding': ['value'], 'inventory.marketValue.tabSummary.unrealized': ['value'],
      'inventory.marketValue.tabSummary.coverage': ['priced', 'total'], 'profit.market.split': ['forSale', 'holding'], 'profit.market.coverage': ['priced', 'total'],
      'profit.market.unavailableHint': ['value'], 'prices.status.updatedAgo': ['time'], 'prices.status.updatedTitle': ['date'], 'prices.status.failedTitle': ['reason'],
      'prices.status.failedTitleWithDate': ['date', 'reason'], 'common.ago.minutes': ['count'], 'common.ago.hours': ['count'], 'common.ago.days': ['count'],
    };
    for (const [key, params] of Object.entries(expected)) {
      for (const [lang, dict] of Object.entries(dicts)) expect(markers(dict[key] ?? ''), `${lang} ${key}`).toEqual([...params].sort());
    }
  });

  test('os motivos e os motivos sem líquido do tipo da API têm texto nos dois idiomas', () => {
    const reasons = ['NO_EXTERIOR', 'PHASE_REQUIRED', 'PHASE_UNMAPPED', 'NOT_PRICEABLE', 'NOT_FETCHED', 'NOT_FOUND', 'NOT_FETCHED_NO_KEY'];
    const net = ['NO_INTEGRATION_STORE', 'FEES_NOT_CONFIGURED', 'NET_NOT_COMPUTABLE', 'GROUP'];
    for (const [lang, dict] of Object.entries(dicts)) {
      for (const r of reasons) expect(dict[`inventory.marketValue.reason.${r}`]?.trim(), `${lang} ${r}`).toBeTruthy();
      for (const r of net) expect(dict[`inventory.marketValue.netUnavailable.${r}`]?.trim(), `${lang} ${r}`).toBeTruthy();
    }
  });

  test('Adendo 1: colunas e cards se chamam PnL não realizado / Unrealized PnL, e o título antigo "Lucro não realizado" não sobrou', () => {
    expect(dicts['pt-BR']['inventory.columns.unrealized']).toBe('Lucro/prejuízo não realizado ≈');
    expect(dicts.en['inventory.columns.unrealized']).toBe('Unrealized profit/loss ≈');
    expect(dicts['pt-BR']['profit.market.pnlLabel']).toBe('PnL não realizado');
    expect(dicts['pt-BR']['profit.market.valueLabel']).toBe('Valor atual de mercado do estoque');
    expect(dicts['pt-BR']['profit.market.badge']).toBe('estimado — não entra no lucro real');
    for (const dict of Object.values(dicts)) {
      for (const [key, text] of Object.entries(dict).filter(([k]) => NEW_SCOPE.test(k))) expect(text, key).not.toMatch(/Lucro não realizado|Unrealized profit(?!\/loss)/i);
    }
  });

  test('o "≈" e o "—" ficam nos rótulos de coluna dos dois idiomas; o texto da tela diz que não é lucro até vender', () => {
    for (const dict of Object.values(dicts)) {
      expect(dict['inventory.columns.marketValue']).toContain('≈');
      expect(dict['inventory.columns.unrealized']).toContain('≈');
    }
    expect(dicts['pt-BR']['profit.market.pnlHint']).toMatch(/não é lucro nem prejuízo até vender/);
    expect(dicts.en['profit.market.pnlHint']).toMatch(/until you sell/i);
  });
});

describe('nenhuma chave usada nos componentes novos falta', () => {
  const collect = (rel: string) => {
    const source = fs.readFileSync(path.join(SRC, rel), 'utf8');
    const keys = new Set<string>();
    for (const m of source.matchAll(/\b(?:t|tLoose|tPlural)\(\s*['`]([A-Za-z0-9_.]+)['`]/g)) keys.add(m[1]);
    const dynamic = [...source.matchAll(/\b(?:t|tLoose|tPlural)\(\s*`([^`]*\$\{[^`]*)`/g)].map((m) => m[1]);
    return { keys, dynamic };
  };

  test.each(FILES)('%s: toda chave literal existe em pt-BR e en (plural: .one e .other)', (rel) => {
    if (!fs.existsSync(path.join(SRC, rel))) return;
    const { keys } = collect(rel);
    for (const key of keys) {
      for (const [lang, dict] of Object.entries(dicts)) {
        const exists = key in dict || (`${key}.one` in dict && `${key}.other` in dict);
        expect(exists, `${lang}: ${key} (${rel})`).toBe(true);
      }
    }
  });

  test('as chaves dinâmicas (reason.*, netUnavailable.*) têm todas as variantes que o código pode montar', () => {
    const cell = fs.readFileSync(path.join(SRC, 'components/MarketValueCell.tsx'), 'utf8');
    expect(cell).toContain('inventory.marketValue.reason.${');
    expect(cell).toContain('inventory.marketValue.netUnavailable.${');
    // `view.reason` do NO_PRICE: NOT_FETCHED | NOT_FOUND | NOT_FETCHED_NO_KEY; do NOT_PRICEABLE: os demais motivos do tipo
    const types = fs.readFileSync(path.join(SRC, 'types/api.ts'), 'utf8');
    const reasonLine = types.match(/MarketValueReason\s*=([^;]+);/s)?.[1] ?? '';
    const codes = [...reasonLine.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(codes).toEqual(expect.arrayContaining(['NO_EXTERIOR', 'PHASE_REQUIRED', 'PHASE_UNMAPPED', 'NOT_PRICEABLE', 'NOT_FETCHED', 'NOT_FOUND']));
    for (const dict of Object.values(dicts)) for (const c of codes) expect(dict[`inventory.marketValue.reason.${c}`], c).toBeTruthy();
    const netLine = types.match(/NetUnavailableReason\s*=([^;]+);/s)?.[1] ?? '';
    const netCodes = [...netLine.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(netCodes.length).toBeGreaterThanOrEqual(3);
    for (const dict of Object.values(dicts)) for (const c of netCodes) expect(dict[`inventory.marketValue.netUnavailable.${c}`], c).toBeTruthy();
  });

  test('o indicador usa errorMessageFor para o motivo da falha (o código vira texto traduzido, nunca o código cru)', () => {
    const indicator = fs.readFileSync(path.join(SRC, 'components/PriceStatusIndicator.tsx'), 'utf8');
    expect(indicator).toContain('errorMessageFor(new ApiRequestError(view.errorCode');
    expect(indicator).toContain("{title && <span className={styles.srOnly}>{title}</span>}");
    expect(indicator).toContain('role="status"');
    expect(indicator).toContain('aria-live="polite"');
    expect(indicator).toMatch(/aria-busy=\{view\.kind === 'REFRESHING'\}/);
  });

  test('o código de erro da rodada que o backend pode devolver (IMPORT_SOURCE_UNREACHABLE e afins) tem tradução em errors.*', () => {
    for (const code of ['IMPORT_SOURCE_UNREACHABLE', 'VALUATION_IN_PROGRESS']) {
      for (const dict of Object.values(dicts)) expect(dict[`errors.${code}`]?.trim(), code).toBeTruthy();
    }
  });
});
