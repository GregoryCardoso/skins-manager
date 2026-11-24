'use strict';

// Adapter da AwesomeAPI (D162). Nunca chama a rede real: `fetchFn` é sempre falso.
const { fetchLatestRate, parseAwesomeApiResponse } = require('../../../src/services/fxRates/awesomeApiAdapter');
const { getProvider } = require('../../../src/services/fxRates');

const NOW = new Date('2026-11-20T15:00:00.000Z');
const entry = (extra = {}) => ({
  code: 'USD',
  codein: 'BRL',
  bid: '5.1234',
  ask: '5.1254',
  timestamp: '1763650800',
  create_date: '2026-11-20 12:00:00',
  ...extra,
});
const json = (row) => ({ USDBRL: row });
const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const fetchOf = (response) => {
  const fn = jest.fn(async () => (typeof response === 'function' ? response() : response));
  return fn;
};
const rejects = (promise, code, status = 502) =>
  expect(promise).rejects.toMatchObject({ code, status, params: { source: 'AWESOMEAPI' } });

describe('awesomeApiAdapter', () => {
  test('usa ask (não bid), com números em texto, e devolve o contrato comum', async () => {
    const fetchFn = fetchOf(ok(json(entry())));
    const quote = await fetchLatestRate({ fetchFn, now: NOW });
    expect(quote).toEqual({
      source: 'AWESOMEAPI',
      rate: 5.1254,
      buyRate: 5.1234,
      sellRate: 5.1254,
      quotedAt: new Date(1763650800 * 1000).toISOString(),
    });
    expect(fetchFn.mock.calls[0][0]).toBe('https://economia.awesomeapi.com.br/json/last/USD-BRL');
  });

  test('sem timestamp usa create_date em -03:00', () => {
    const { timestamp, ...row } = entry();
    expect(parseAwesomeApiResponse(json(row)).quotedAt).toBe('2026-11-20T15:00:00.000Z');
  });

  test('timestamp inválido cai para create_date; sem nenhum dos dois recusa', () => {
    expect(parseAwesomeApiResponse(json(entry({ timestamp: 'abc' }))).quotedAt).toBe('2026-11-20T15:00:00.000Z');
    expect(() => parseAwesomeApiResponse(json(entry({ timestamp: undefined, create_date: undefined })))).toThrow(
      expect.objectContaining({ code: 'FX_INVALID_RESPONSE' })
    );
  });

  test.each([['abc'], ['0'], ['60'], [undefined], ['-5'], [5.1], ['5,1']])('ask %p é recusado', (ask) => {
    expect(() => parseAwesomeApiResponse(json(entry({ ask })))).toThrow(
      expect.objectContaining({ code: 'FX_INVALID_RESPONSE', params: { source: 'AWESOMEAPI' } })
    );
  });

  test('bid inválido não impede o uso do ask (buyRate nulo)', () => {
    expect(parseAwesomeApiResponse(json(entry({ bid: 'x' }))).buyRate).toBeNull();
  });

  test.each([[{ code: 'EUR' }], [{ codein: 'USD' }]])('par de moedas errado %p é recusado', (extra) => {
    expect(() => parseAwesomeApiResponse(json(entry(extra)))).toThrow(expect.objectContaining({ code: 'FX_INVALID_RESPONSE' }));
  });

  test.each([[null], [{}], [[]], ['x']])('formato %p é recusado', (body) => {
    expect(() => parseAwesomeApiResponse(body)).toThrow(expect.objectContaining({ code: 'FX_INVALID_RESPONSE' }));
  });

  test('JSON inválido e resposta acima de 64 KB -> FX_INVALID_RESPONSE', async () => {
    await rejects(fetchLatestRate({ fetchFn: fetchOf({ ok: true, status: 200, text: async () => '{oops' }), now: NOW }), 'FX_INVALID_RESPONSE');
    const big = { ok: true, status: 200, text: async () => JSON.stringify(json(entry({ pad: 'x'.repeat(70 * 1024) }))) };
    await rejects(fetchLatestRate({ fetchFn: fetchOf(big), now: NOW }), 'FX_INVALID_RESPONSE');
  });

  test('content-length acima do limite é recusado sem ler o corpo', async () => {
    const text = jest.fn(async () => '{}');
    const response = { ok: true, status: 200, headers: { get: () => String(70 * 1024) }, text };
    await rejects(fetchLatestRate({ fetchFn: fetchOf(response), now: NOW }), 'FX_INVALID_RESPONSE');
    expect(text).not.toHaveBeenCalled();
  });

  test('HTTP 500 -> FX_SOURCE_UNAVAILABLE; rede que lança e fetch ausente -> FX_FETCH_FAILED', async () => {
    await rejects(fetchLatestRate({ fetchFn: fetchOf({ ok: false, status: 500 }), now: NOW }), 'FX_SOURCE_UNAVAILABLE');
    await rejects(fetchLatestRate({ fetchFn: async () => { throw new Error('offline'); }, now: NOW }), 'FX_FETCH_FAILED');
    await rejects(fetchLatestRate({ fetchFn: null, now: NOW }), 'FX_FETCH_FAILED');
  });

  test('HTTP 429 -> FX_RATE_LIMITED', async () => {
    await rejects(fetchLatestRate({ fetchFn: fetchOf({ ok: false, status: 429 }), now: NOW }), 'FX_RATE_LIMITED');
  });

  test('timeout por chamada aborta o sinal e vira FX_FETCH_FAILED', async () => {
    let signal;
    const fetchFn = (url, options) => {
      signal = options.signal;
      return new Promise(() => {});
    };
    await rejects(fetchLatestRate({ fetchFn, now: NOW, callTimeoutMs: 30 }), 'FX_FETCH_FAILED');
    expect(signal.aborted).toBe(true);
  });

  test('registro das fontes devolve os dois provedores com o mesmo contrato', () => {
    expect(typeof getProvider('AWESOMEAPI').fetchLatestRate).toBe('function');
    expect(typeof getProvider('PTAX').fetchLatestRate).toBe('function');
    expect(() => getProvider('X')).toThrow();
    expect(() => getProvider('__proto__')).toThrow();
  });
});
