'use strict';

// Lacunas do adapter da AwesomeAPI (D162): fetchFn sempre falso, nunca a API real.
const { fetchLatestRate, parseAwesomeApiResponse } = require('../../../src/services/fxRates/awesomeApiAdapter');
const { fetchJson } = require('../../../src/services/fxRates/fxHttp');
const { FX_MAX_RESPONSE_BYTES } = require('../../../src/config/constants');

const NOW = new Date('2026-11-20T15:00:00.000Z');
const row = (extra = {}) => ({ code: 'USD', codein: 'BRL', bid: '5.1', ask: '5.2', timestamp: '1763650800', ...extra });
const wrap = (r) => ({ USDBRL: r });
const rejects = (promise, code) => expect(promise).rejects.toMatchObject({ code, status: 502, params: { source: 'AWESOMEAPI' } });
const invalid = () => expect.objectContaining({ code: 'FX_INVALID_RESPONSE' });

describe('awesomeApiAdapter: lacunas', () => {
  test.each([['1', 1], ['50', 50], ['1.0001', 1.0001], ['49.9999', 49.9999]])('ask %p dentro da faixa 1..50 é aceito', (ask, expected) => {
    expect(parseAwesomeApiResponse(wrap(row({ ask }))).sellRate).toBe(expected);
  });

  test.each(['0.9999', '50.0001', '51', '0', '', ' ', '1e1', '+5', '.5', '5.', 'Infinity', 'NaN', '0x10', '5 1'])(
    'ask %p fora da faixa ou mal formado é recusado',
    (ask) => {
      expect(() => parseAwesomeApiResponse(wrap(row({ ask })))).toThrow(invalid());
    }
  );

  test.each([[null], [undefined], [{}], [[]], [true]])('ask não textual %p é recusado', (ask) => {
    expect(() => parseAwesomeApiResponse(wrap(row({ ask })))).toThrow(invalid());
  });

  test.each([[{ code: 'usd' }], [{ code: undefined }], [{ codein: 'brl' }], [{ codein: undefined }], [{ code: 'BRL', codein: 'USD' }]])(
    'code/codein %p é recusado',
    (extra) => {
      expect(() => parseAwesomeApiResponse(wrap(row(extra)))).toThrow(invalid());
    }
  );

  test('objeto USDBRL ausente (outra chave, null ou não objeto) é recusado', () => {
    for (const body of [{ EURBRL: row() }, { USDBRL: null }, { USDBRL: 'x' }, { USDBRL: 5 }, { USD: row() }]) {
      expect(() => parseAwesomeApiResponse(body)).toThrow(invalid());
    }
  });

  test('timestamp em segundos Unix (texto e número) e create_date em -03:00', () => {
    expect(parseAwesomeApiResponse(wrap(row({ timestamp: '1763650800' }))).quotedAt).toBe('2025-11-20T15:00:00.000Z');
    expect(parseAwesomeApiResponse(wrap(row({ timestamp: 1763650800 }))).quotedAt).toBe('2025-11-20T15:00:00.000Z');
    // milissegundos (13 dígitos) não valem como segundos: cai para create_date
    expect(parseAwesomeApiResponse(wrap(row({ timestamp: '1763650800000', create_date: '2026-11-20 12:00:00' }))).quotedAt).toBe(
      '2026-11-20T15:00:00.000Z'
    );
    // 23:30 em Brasília já é o dia seguinte em UTC
    expect(parseAwesomeApiResponse(wrap(row({ timestamp: undefined, create_date: '2026-11-20 23:30:00' }))).quotedAt).toBe(
      '2026-11-21T02:30:00.000Z'
    );
    expect(parseAwesomeApiResponse(wrap(row({ timestamp: '0', create_date: '2026-11-20 12:00:00' }))).quotedAt).toBe('2026-11-20T15:00:00.000Z');
  });

  test('create_date impossível é recusado', () => {
    expect(() => parseAwesomeApiResponse(wrap(row({ timestamp: undefined, create_date: '2026-13-40 99:99:99' })))).toThrow(invalid());
  });

  test('resposta em stream sem content-length que passa de 64 KB é cancelada', async () => {
    const cancel = jest.fn(async () => {});
    const chunk = new Uint8Array(40 * 1024);
    let calls = 0;
    const reader = {
      read: jest.fn(async () => {
        calls += 1;
        return calls <= 5 ? { done: false, value: chunk } : { done: true };
      }),
      cancel,
    };
    const fetchFn = async () => ({ ok: true, status: 200, headers: { get: () => null }, body: { getReader: () => reader } });
    await rejects(fetchLatestRate({ fetchFn, now: NOW }), 'FX_INVALID_RESPONSE');
    expect(cancel).toHaveBeenCalled();
    expect(calls).toBe(2);
  });

  test('stream pequeno e válido é lido por inteiro', async () => {
    const bytes = Buffer.from(JSON.stringify(wrap(row())));
    let sent = false;
    const reader = {
      read: async () => {
        if (sent) return { done: true };
        sent = true;
        return { done: false, value: bytes };
      },
      cancel: async () => {},
    };
    const fetchFn = async () => ({ ok: true, status: 200, body: { getReader: () => reader } });
    await expect(fetchLatestRate({ fetchFn, now: NOW })).resolves.toMatchObject({ source: 'AWESOMEAPI', rate: 5.2, buyRate: 5.1 });
  });

  test('exatamente no teto de bytes passa; um byte a mais não', async () => {
    const base = JSON.stringify(wrap(row({ pad: '' })));
    const exact = JSON.stringify(wrap(row({ pad: 'x'.repeat(FX_MAX_RESPONSE_BYTES - Buffer.byteLength(base)) })));
    expect(Buffer.byteLength(exact)).toBe(FX_MAX_RESPONSE_BYTES);
    await expect(fetchLatestRate({ fetchFn: async () => ({ ok: true, status: 200, text: async () => exact }), now: NOW })).resolves.toMatchObject({
      rate: 5.2,
    });
    await rejects(fetchLatestRate({ fetchFn: async () => ({ ok: true, status: 200, text: async () => `${exact} ` }), now: NOW }), 'FX_INVALID_RESPONSE');
  });

  test('429 vira FX_RATE_LIMITED; 404 e 503 viram FX_FETCH_FAILED', async () => {
    await rejects(fetchLatestRate({ fetchFn: async () => ({ ok: false, status: 429, text: async () => '{}' }), now: NOW }), 'FX_RATE_LIMITED');
    for (const status of [404, 503]) {
      await rejects(fetchLatestRate({ fetchFn: async () => ({ ok: false, status }), now: NOW }), 'FX_FETCH_FAILED');
    }
  });

  test('prazo total já expirado (sinal abortado) falha sem esperar a rede', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchJson('http://x', { fetchFn: () => new Promise(() => {}), source: 'AWESOMEAPI', callTimeoutMs: 5000, totalSignal: controller.signal })
    ).rejects.toMatchObject({ code: 'FX_FETCH_FAILED' });
  });
});
