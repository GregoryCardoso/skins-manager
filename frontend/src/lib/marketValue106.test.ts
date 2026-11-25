import { afterEach, describe, expect, test, vi } from 'vitest';
import { agoParts, formatAgo } from './format';
import { resetAutoImportProgressForTests, reportAutoImport, getAutoImportProgress } from './autoImportProgress';
import {
  groupMarketCell, groupUnrealizedCell, profitUnrealizedCard, profitValueCard, tabSummary, unitMarketCell, unitUnrealizedCell,
} from './marketValueDisplay';
import { decidePriceRefreshStart, nextAfterRefresh } from './priceRefresh';
import { priceStatusView } from './priceStatus';
import { getMarketValueSummary, refreshMarketValues } from '@/services/api';
import type { IntegrationView, MarketValue, MarketValueSummary, MarketValueTotals } from '@/types/api';

// 10.6 (D365): funções puras do valor de mercado e o cliente da API.

const integration = (extra: Partial<IntegrationView> = {}) => ({
  autoImportOnOpen: true, autoImportPaused: false, hasApiKey: true, storeId: 1, tradesCutoffAt: '2026-01-01T00:00:00.000Z', importInProgress: false, ...extra,
}) as IntegrationView;

describe('decidePriceRefreshStart', () => {
  test('consulta pendente espera; importação devida e IDLE espera; RUNNING espera; DONE vai', () => {
    expect(decidePriceRefreshStart({ integrationStatus: 'pending', integration: null, autoImport: 'IDLE' })).toBe('WAIT');
    expect(decidePriceRefreshStart({ integrationStatus: 'success', integration: integration(), autoImport: 'IDLE' })).toBe('WAIT');
    expect(decidePriceRefreshStart({ integrationStatus: 'success', integration: integration(), autoImport: 'RUNNING' })).toBe('WAIT');
    expect(decidePriceRefreshStart({ integrationStatus: 'success', integration: integration(), autoImport: 'DONE' })).toBe('GO');
  });
  test('sem importação a fazer vai já; erro na consulta vai', () => {
    for (const extra of [{ autoImportOnOpen: false }, { autoImportPaused: true }, { hasApiKey: false }, { storeId: null }, { tradesCutoffAt: null }, { importInProgress: true }]) {
      expect(decidePriceRefreshStart({ integrationStatus: 'success', integration: integration(extra), autoImport: 'IDLE' })).toBe('GO');
    }
    expect(decidePriceRefreshStart({ integrationStatus: 'error', integration: null, autoImport: 'IDLE' })).toBe('GO');
  });
});

describe('nextAfterRefresh', () => {
  const resp = (extra: object) => ({ skipped: null, result: { requested: 1, fetched: 1 }, failed: null, ...extra }) as never;
  test('BUSY repete uma vez; depois para', () => {
    expect(nextAfterRefresh(resp({ skipped: 'BUSY', result: null }), { retried: false }).action).toBe('RETRY_WHEN_IDLE');
    expect(nextAfterRefresh(resp({ skipped: 'BUSY', result: null }), { retried: true })).toEqual({ action: 'DONE', invalidate: 'marketValues.status' });
  });
  test('outros skipped, failed e erros só atualizam o indicador', () => {
    for (const skipped of ['ALREADY_RAN', 'COOLDOWN', 'NOT_CONFIGURED']) {
      expect(nextAfterRefresh(resp({ skipped, result: null }), { retried: false })).toEqual({ action: 'DONE', invalidate: 'marketValues.status' });
    }
    expect(nextAfterRefresh(resp({ failed: { code: 'X' } }), { retried: false }).invalidate).toBe('marketValues.status');
    expect(nextAfterRefresh(new Error('rede'), { retried: false })).toEqual({ action: 'DONE', invalidate: 'marketValues.status' });
  });
  test('preço novo recarrega os itens; nada novo, só o indicador', () => {
    expect(nextAfterRefresh(resp({}), { retried: false })).toEqual({ action: 'DONE', invalidate: 'marketValues.refresh' });
    expect(nextAfterRefresh(resp({ result: { requested: 0, fetched: 0 } }), { retried: false }).invalidate).toBe('marketValues.status');
  });
});

describe('autoImportProgress', () => {
  afterEach(() => resetAutoImportProgressForTests());
  test('muda e volta ao inicial', () => {
    expect(getAutoImportProgress()).toBe('IDLE');
    reportAutoImport('RUNNING');
    expect(getAutoImportProgress()).toBe('RUNNING');
  });
});

describe('priceStatusView', () => {
  const totals = (unitCount: number) => ({ unitCount }) as MarketValueTotals;
  const summary = (extra: Partial<MarketValueSummary> = {}) => ({
    configured: true, inProgress: false, lastRefreshAt: null, lastRun: null, totals: totals(3), ...extra,
  }) as MarketValueSummary;
  test('precedência', () => {
    expect(priceStatusView({ summary: summary({ inProgress: true, configured: false }), refreshing: false }).kind).toBe('REFRESHING');
    expect(priceStatusView({ summary: summary(), refreshing: true }).kind).toBe('REFRESHING');
    expect(priceStatusView({ summary: summary({ configured: false, lastRun: { at: 'x', status: 'FAILED', errorCode: 'E' } }), refreshing: false }).kind).toBe('NOT_CONFIGURED');
    expect(priceStatusView({ summary: summary({ lastRun: { at: 'x', status: 'FAILED', errorCode: 'E' }, lastRefreshAt: 'd' }), refreshing: false })).toEqual({ kind: 'FAILED', at: 'd', errorCode: 'E' });
    expect(priceStatusView({ summary: summary({ lastRun: { at: 'x', status: 'PARTIAL', errorCode: null }, lastRefreshAt: 'd' }), refreshing: false }).kind).toBe('UPDATED');
    expect(priceStatusView({ summary: summary({ totals: totals(0) }), refreshing: false }).kind).toBe('HIDDEN');
    expect(priceStatusView({ summary: summary(), refreshing: false }).kind).toBe('NEVER');
    expect(priceStatusView({ summary: null, refreshing: false }).kind).toBe('HIDDEN');
  });
});

describe('formatAgo', () => {
  const now = new Date('2026-11-24T12:00:00.000Z');
  const t = (key: string, params?: Record<string, string | number>) => `${key}:${params?.count}`;
  test.each([
    ['2026-11-24T11:59:30.000Z', 'LESS_THAN_MINUTE', 0],
    ['2026-11-24T11:01:00.000Z', 'MINUTES', 59],
    ['2026-11-24T11:00:00.000Z', 'HOURS', 1],
    ['2026-11-23T13:00:00.000Z', 'HOURS', 23],
    ['2026-11-21T12:00:00.000Z', 'DAYS', 3],
    ['2026-11-24T12:05:00.000Z', 'LESS_THAN_MINUTE', 0],
  ])('%s', (iso, unit, count) => {
    expect(agoParts(iso, now)).toEqual({ unit, count });
  });
  test('usa as chaves common.ago.*', () => {
    expect(formatAgo('2026-11-21T12:00:00.000Z', now, t)).toBe('common.ago.days:3');
  });
});

const mv = (extra: Partial<MarketValue> = {}): MarketValue => ({
  marketValueUsdCents: 1000, parts: { baseCents: 1000, hangingCents: null, stickersInfoCents: 0, patchesInfoCents: 0 }, costUsdCents: 600, costEstimated: false,
  unrealizedUsdCents: 400, unrealizedNetUsdCents: 380, netUnavailableReason: null, pricedAt: '2026-11-24T10:00:00.000Z', isStale: false, status: 'OK',
  reason: null, isComplete: true, missing: [], basis: 'NAME', isEstimated: true, approx: { marketValue: 5000, unrealized: 2000, unrealizedNet: 1900 }, ...extra,
});

describe('células da unidade', () => {
  test('estados do valor', () => {
    expect(unitMarketCell(null)).toEqual({ kind: 'NONE' });
    expect(unitMarketCell(mv())).toMatchObject({ kind: 'OK', usdCents: 1000, brlCents: 5000, stale: false, incomplete: false });
    expect(unitMarketCell(mv({ isStale: true, isComplete: false }))).toMatchObject({ stale: true, incomplete: true });
    expect(unitMarketCell(mv({ status: 'NO_PRICE', marketValueUsdCents: null, reason: 'NOT_FOUND' }))).toEqual({ kind: 'NO_PRICE', reason: 'NOT_FOUND' });
    expect(unitMarketCell(mv({ status: 'NO_PRICE', marketValueUsdCents: null, reason: null }))).toEqual({ kind: 'NO_PRICE', reason: 'NOT_FETCHED' });
    expect(unitMarketCell(mv({ status: 'NOT_PRICEABLE', marketValueUsdCents: null, reason: 'PHASE_REQUIRED' }))).toEqual({ kind: 'NOT_PRICEABLE', reason: 'PHASE_REQUIRED' });
  });
  test('stickers e patches ficam só nas partes informativas', () => {
    const view = unitMarketCell(mv({ parts: { baseCents: 1000, hangingCents: 200, stickersInfoCents: 50, patchesInfoCents: 10 }, marketValueUsdCents: 1200 }));
    expect(view).toMatchObject({ usdCents: 1200, parts: { stickersInfoCents: 50, patchesInfoCents: 10 } });
  });
  test('PnL não realizado: líquido com sinal; sem líquido "—" com o motivo e o bruto', () => {
    expect(unitUnrealizedCell(mv())).toMatchObject({ kind: 'NET', cents: 380, sign: 'POSITIVE', brlCents: 1900 });
    expect(unitUnrealizedCell(mv({ unrealizedNetUsdCents: -50 }))).toMatchObject({ sign: 'NEGATIVE' });
    expect(unitUnrealizedCell(mv({ unrealizedNetUsdCents: 0 }))).toMatchObject({ sign: 'ZERO' });
    expect(unitUnrealizedCell(mv({ unrealizedNetUsdCents: null, netUnavailableReason: 'NO_INTEGRATION_STORE' })))
      .toEqual({ kind: 'NET_UNAVAILABLE', reason: 'NO_INTEGRATION_STORE', grossCents: 400 });
    expect(unitUnrealizedCell(mv({ costUsdCents: null }))).toEqual({ kind: 'NONE' });
    expect(unitUnrealizedCell(mv({ status: 'NO_PRICE' }))).toEqual({ kind: 'NONE' });
  });
});

const totals = (extra: Partial<MarketValueTotals> = {}): MarketValueTotals => ({
  marketValueUsdCents: 3000, costUsdCents: 2000, unrealizedUsdCents: 1000, unrealizedNetUsdCents: 900, costEstimated: false, pricedUnits: 3, netUnits: 3,
  unpricedUnits: 0, notPriceableUnits: 0, staleUnits: 0, unitCount: 3, approx: { marketValue: 15000, unrealized: 5000, unrealizedNet: 4500 }, ...extra,
});

describe('células de grupo, resumo da aba e cards do lucro real', () => {
  test('grupo', () => {
    expect(groupMarketCell(totals())).toMatchObject({ kind: 'OK', partial: false });
    expect(groupMarketCell(totals({ pricedUnits: 2, staleUnits: 1 }))).toMatchObject({ partial: true, staleUnits: 1 });
    expect(groupMarketCell(totals({ pricedUnits: 0, unpricedUnits: 3 }))).toMatchObject({ kind: 'NO_PRICE' });
    expect(groupMarketCell(totals({ pricedUnits: 0, notPriceableUnits: 3 }))).toMatchObject({ kind: 'NOT_PRICEABLE' });
    expect(groupUnrealizedCell(totals())).toMatchObject({ kind: 'NET', partial: false });
    expect(groupUnrealizedCell(totals({ netUnits: 2 }))).toMatchObject({ kind: 'NET', partial: true });
    expect(groupUnrealizedCell(totals({ netUnits: 0 }))).toEqual({ kind: 'NET_UNAVAILABLE', grossCents: 1000 });
    expect(groupUnrealizedCell(totals({ pricedUnits: 0 }))).toEqual({ kind: 'NONE' });
  });
  test('resumo da aba some sem unidades ou sem preço', () => {
    expect(tabSummary(totals())).toMatchObject({ usdCents: 3000, netCents: 900, pricedUnits: 3 });
    expect(tabSummary(totals({ netUnits: 0 }))).toMatchObject({ netCents: null, netSign: null });
    expect(tabSummary(totals({ unitCount: 0 }))).toBeNull();
    expect(tabSummary(totals({ pricedUnits: 0 }))).toBeNull();
  });
  test('cards do lucro real: sem preço nunca vira zero; sem líquido "indisponível"; parcial', () => {
    expect(profitValueCard(totals({ pricedUnits: 0 }))).toEqual({ kind: 'NO_PRICE' });
    expect(profitValueCard(totals())).toMatchObject({ kind: 'OK', usdCents: 3000 });
    expect(profitUnrealizedCard(totals({ netUnits: 0 }))).toEqual({ kind: 'UNAVAILABLE', grossCents: 1000 });
    expect(profitUnrealizedCard(totals({ netUnits: 1 }))).toMatchObject({ kind: 'NET', partial: true });
    expect(profitUnrealizedCard(totals({ unrealizedNetUsdCents: -5 }))).toMatchObject({ sign: 'NEGATIVE' });
  });
});

describe('cliente da API', () => {
  afterEach(() => vi.unstubAllGlobals());
  test('POST do refresh com corpo {} e JSON; GET do summary; erro vira ApiRequestError', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: { skipped: null, result: null, failed: null } }) });
    vi.stubGlobal('fetch', fetchMock);
    await refreshMarketValues();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/market-values\/refresh$/);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect(init.headers['Content-Type']).toBe('application/json');
    await getMarketValueSummary();
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/api\/market-values\/summary$/);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ success: false, error: { code: 'X', message: 'm' } }) }));
    await expect(refreshMarketValues()).rejects.toMatchObject({ code: 'X' });
  });
});
