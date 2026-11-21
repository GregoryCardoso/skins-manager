'use strict';

// T80a: readLimitedText compartilhado; cada chamador mantém o seu código de erro.
const { readLimitedText } = require('../../src/services/fxRates/fxHttp');
const { fetchLatestRate } = require('../../src/services/fxRates/awesomeApiAdapter');
const { FX_MAX_RESPONSE_BYTES } = require('../../src/config/constants');

const boom = () => new Error('grande');
const stream = (chunks) => {
  let i = 0;
  const cancel = jest.fn(async () => {});
  return { reader: { read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }), cancel }, cancel };
};

describe('readLimitedText', () => {
  test('content-length acima do teto lança o erro do chamador sem ler o corpo', async () => {
    const text = jest.fn();
    await expect(readLimitedText({ headers: { get: () => '11' }, text }, 10, boom)).rejects.toThrow('grande');
    expect(text).not.toHaveBeenCalled();
  });
  test('stream: exatamente no teto passa; um byte a mais cancela e lança', async () => {
    const ok = stream([new Uint8Array(6), new Uint8Array(4)]);
    await expect(readLimitedText({ body: { getReader: () => ok.reader } }, 10, boom)).resolves.toHaveLength(10);
    const big = stream([new Uint8Array(6), new Uint8Array(5)]);
    await expect(readLimitedText({ body: { getReader: () => big.reader } }, 10, boom)).rejects.toThrow('grande');
    expect(big.cancel).toHaveBeenCalled();
  });
  test('text(): conta bytes (UTF-8), não caracteres', async () => {
    await expect(readLimitedText({ text: async () => 'ééééé' }, 10, boom)).resolves.toBe('ééééé');
    await expect(readLimitedText({ text: async () => 'éééééx' }, 10, boom)).rejects.toThrow('grande');
  });
  test('sem stream nem text() devolve null', async () => {
    await expect(readLimitedText({ json: async () => ({}) }, 10, boom)).resolves.toBeNull();
  });
});

describe('cotação mantém FX_INVALID_RESPONSE', () => {
  const NOW = new Date('2026-11-19T15:00:00.000Z');
  const rejectsInvalid = (p) => expect(p).rejects.toMatchObject({ code: 'FX_INVALID_RESPONSE' });
  test('content-length acima do teto', async () => {
    await rejectsInvalid(
      fetchLatestRate({ fetchFn: async () => ({ ok: true, status: 200, headers: { get: () => String(FX_MAX_RESPONSE_BYTES + 1) }, text: async () => '{}' }), now: NOW })
    );
  });
  test('resposta só com json() acima do teto', async () => {
    const big = { pad: 'x'.repeat(FX_MAX_RESPONSE_BYTES + 1) };
    await rejectsInvalid(fetchLatestRate({ fetchFn: async () => ({ ok: true, status: 200, json: async () => big }), now: NOW }));
  });
});
