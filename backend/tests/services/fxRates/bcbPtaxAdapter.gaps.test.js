'use strict';

// Lacunas do adapter da PTAX (D147). fetchFn sempre falso.
const { candidateDays, parsePtaxResponse, fetchLatestPtax } = require('../../../src/services/fxRates/bcbPtaxAdapter');

const THURSDAY = new Date('2026-11-19T15:00:00.000Z');
const ok = (json) => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });
const row = (extra = {}) => ({ cotacaoCompra: 5.2, cotacaoVenda: 5.4, dataHoraCotacao: '2026-11-19 13:04:28.123', ...extra });

describe('PTAX: virada de dia UTC x Brasília', () => {
  test('01:00Z de sexta ainda é quinta em Brasília (22:00)', () => {
    expect(candidateDays(new Date('2026-11-20T01:00:00.000Z'))[0]).toBe('2026-11-19');
  });
  test('02:59:59Z ainda é o dia anterior; 03:00Z já é o dia seguinte', () => {
    expect(candidateDays(new Date('2026-11-20T02:59:59.999Z'))[0]).toBe('2026-11-19');
    expect(candidateDays(new Date('2026-11-20T03:00:00.000Z'))[0]).toBe('2026-11-20');
  });
  test('01:00Z de segunda é domingo em Brasília: começa na sexta', () => {
    expect(candidateDays(new Date('2026-11-23T01:00:00.000Z'))[0]).toBe('2026-11-20');
  });
});

describe('PTAX: cotação de venda e linhas', () => {
  test('usa a venda mesmo quando a compra é válida e diferente', () => {
    expect(parsePtaxResponse({ value: [row()] }).sellRate).toBe(5.4);
  });
  test('cotacaoVenda ausente (mesmo com compra válida) → FX_INVALID_RESPONSE', () => {
    const r = row();
    delete r.cotacaoVenda;
    expect(() => parsePtaxResponse({ value: [r] })).toThrow(expect.objectContaining({ code: 'FX_INVALID_RESPONSE' }));
  });
  test('compra ausente ou inválida não impede o uso da venda (buyRate nulo)', () => {
    expect(parsePtaxResponse({ value: [row({ cotacaoCompra: undefined })] }).buyRate).toBeNull();
    expect(parsePtaxResponse({ value: [row({ cotacaoCompra: 0 })] }).sellRate).toBe(5.4);
  });
  test('várias linhas: usa a primeira (a URL pede $top=1; o recurso do dia devolve uma só, a de fechamento)', () => {
    const quote = parsePtaxResponse({
      value: [row({ cotacaoVenda: 5.4 }), row({ cotacaoVenda: 5.9, dataHoraCotacao: '2026-11-19 17:00:00.000' })],
    });
    expect(quote.sellRate).toBe(5.4);
  });
  test('dias candidatos sem repetição e do mais novo para o mais antigo', () => {
    const days = candidateDays(THURSDAY);
    expect([...days].sort().reverse()).toEqual(days);
    expect(new Set(days).size).toBe(days.length);
  });
});

describe('PTAX: falhas em dias intermediários', () => {
  test('erro de rede no segundo dia aborta a série (não pula para o próximo)', async () => {
    let n = 0;
    const fetchFn = jest.fn(async () => {
      n += 1;
      if (n === 1) return ok({ value: [] });
      throw new TypeError('fetch failed');
    });
    await expect(fetchLatestPtax({ fetchFn, now: THURSDAY })).rejects.toMatchObject({ code: 'FX_FETCH_FAILED' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  test('resposta inválida no segundo dia aborta com FX_INVALID_RESPONSE', async () => {
    let n = 0;
    const fetchFn = async () => (++n === 1 ? ok({ value: [] }) : ok({ value: [row({ cotacaoVenda: 0 })] }));
    await expect(fetchLatestPtax({ fetchFn, now: THURSDAY })).rejects.toMatchObject({ code: 'FX_INVALID_RESPONSE' });
  });
  test('HTTP 404 e resposta nula → FX_FETCH_FAILED', async () => {
    await expect(fetchLatestPtax({ fetchFn: async () => ({ ok: false, status: 404 }), now: THURSDAY })).rejects.toMatchObject({
      code: 'FX_FETCH_FAILED',
    });
    await expect(fetchLatestPtax({ fetchFn: async () => null, now: THURSDAY })).rejects.toMatchObject({
      code: 'FX_FETCH_FAILED',
    });
  });
  test('corpo que falha ao ler (text rejeita) → FX_FETCH_FAILED', async () => {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new Error('reset');
      },
    });
    await expect(fetchLatestPtax({ fetchFn, now: THURSDAY })).rejects.toMatchObject({ code: 'FX_FETCH_FAILED' });
  });
  test('exatamente 64 KB é aceito; 64 KB + 1 byte é recusado', async () => {
    const limit = 64 * 1024;
    const base = JSON.stringify({ value: [row()], pad: '' });
    const exact = JSON.stringify({ value: [row()], pad: 'x'.repeat(limit - Buffer.byteLength(base)) });
    expect(Buffer.byteLength(exact)).toBe(limit);
    const asText = (text) => async () => ({ ok: true, status: 200, text: async () => text });
    expect((await fetchLatestPtax({ fetchFn: asText(exact), now: THURSDAY })).sellRate).toBe(5.4);
    await expect(fetchLatestPtax({ fetchFn: asText(exact + ' '), now: THURSDAY })).rejects.toMatchObject({
      code: 'FX_INVALID_RESPONSE',
    });
  });
});
