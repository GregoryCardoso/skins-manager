'use strict';

// Adapter da PTAX (D147). Nunca chama a rede real: `fetchFn` é sempre falso.
const {
  buildPtaxUrl,
  parsePtaxResponse,
  candidateDays,
  fetchLatestPtax,
} = require('../../../src/services/ptax/bcbPtaxAdapter');

const THURSDAY = new Date('2026-11-19T15:00:00.000Z'); // 12:00 em Brasília
const row = (extra = {}) => ({
  cotacaoCompra: 5.3,
  cotacaoVenda: 5.3012,
  dataHoraCotacao: '2026-11-19 13:04:28.123',
  ...extra,
});
const okResponse = (json) => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });
const code = (c) => expect.objectContaining({ code: c, status: 502 });

// fetch falso por dia "MM-DD-AAAA" -> resposta (ou função); registra as datas consultadas.
function fakeFetch(byDay, { fallback } = {}) {
  const calls = [];
  const fn = async (url) => {
    const day = /@dataCotacao='(\d\d-\d\d-\d{4})'/.exec(url)[1];
    calls.push(day);
    const entry = byDay[day] ?? fallback ?? { value: [] };
    return typeof entry === 'function' ? entry() : okResponse(entry);
  };
  fn.calls = calls;
  return fn;
}

describe('buildPtaxUrl', () => {
  test('recurso CotacaoDolarDia, data MM-DD-AAAA entre aspas e campos selecionados', () => {
    expect(buildPtaxUrl('2026-11-19')).toBe(
      "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)" +
        "?@dataCotacao='11-19-2026'&$top=1&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao"
    );
  });
  test('data fora do formato é erro de programação', () => {
    expect(() => buildPtaxUrl('19/11/2026')).toThrow();
  });
});

describe('parsePtaxResponse', () => {
  test('value vazio → null (sem cotação no dia)', () => {
    expect(parsePtaxResponse({ value: [] })).toBeNull();
  });
  test('usa a cotação de venda e converte a data de Brasília para ISO UTC', () => {
    expect(parsePtaxResponse({ value: [row()] })).toEqual({
      buyRate: 5.3,
      sellRate: 5.3012,
      quotedAt: '2026-11-19T16:04:28.123Z',
    });
  });
  test('fração de segundo ausente ou longa', () => {
    expect(parsePtaxResponse({ value: [row({ dataHoraCotacao: '2026-11-19 13:04:28' })] }).quotedAt).toBe('2026-11-19T16:04:28.000Z');
    expect(parsePtaxResponse({ value: [row({ dataHoraCotacao: '2026-11-19 13:04:28.1234567' })] }).quotedAt).toBe('2026-11-19T16:04:28.123Z');
  });
  test.each([null, 'x', {}, { value: 1 }, { value: [null] }])('formato %p → PTAX_INVALID_RESPONSE', (json) => {
    expect(() => parsePtaxResponse(json)).toThrow(expect.objectContaining({ code: 'PTAX_INVALID_RESPONSE' }));
  });
  test.each([0, -5.3, 0.99, 50.01, 1000, '5.3', null, NaN, Infinity])('cotacaoVenda %p → PTAX_INVALID_RESPONSE', (v) => {
    expect(() => parsePtaxResponse({ value: [row({ cotacaoVenda: v })] })).toThrow(
      expect.objectContaining({ code: 'PTAX_INVALID_RESPONSE' })
    );
  });
  test('limites 1 e 50 são aceitos', () => {
    expect(parsePtaxResponse({ value: [row({ cotacaoVenda: 1 })] }).sellRate).toBe(1);
    expect(parsePtaxResponse({ value: [row({ cotacaoVenda: 50 })] }).sellRate).toBe(50);
  });
  test('data da cotação inválida → PTAX_INVALID_RESPONSE', () => {
    for (const dataHoraCotacao of [undefined, 'ontem', '2026-13-45 99:99:99']) {
      expect(() => parsePtaxResponse({ value: [row({ dataHoraCotacao })] })).toThrow(
        expect.objectContaining({ code: 'PTAX_INVALID_RESPONSE' })
      );
    }
  });
});

describe('candidateDays (fuso de São Paulo, sem fim de semana, até 7 dias)', () => {
  test('quinta: hoje e recuo pulando sábado e domingo', () => {
    expect(candidateDays(THURSDAY)).toEqual(['2026-11-19', '2026-11-18', '2026-11-17', '2026-11-16', '2026-11-13', '2026-11-12']);
  });
  test('sábado e domingo não são consultados', () => {
    expect(candidateDays(new Date('2026-11-21T15:00:00.000Z'))).toEqual(['2026-11-20', '2026-11-19', '2026-11-18', '2026-11-17', '2026-11-16']);
    expect(candidateDays(new Date('2026-11-22T15:00:00.000Z'))[0]).toBe('2026-11-20');
  });
  test('virada de dia: 02:00Z de sexta ainda é quinta em Brasília', () => {
    expect(candidateDays(new Date('2026-11-20T02:00:00.000Z'))[0]).toBe('2026-11-19');
  });
  test('03:00Z já é o dia seguinte em Brasília', () => {
    expect(candidateDays(new Date('2026-11-20T03:00:00.000Z'))[0]).toBe('2026-11-20');
  });
});

describe('fetchLatestPtax', () => {
  test('dia útil com cotação: uma chamada só', async () => {
    const fetchFn = fakeFetch({ '11-19-2026': { value: [row()] } });
    const quote = await fetchLatestPtax({ fetchFn, now: THURSDAY });
    expect(quote).toEqual({ buyRate: 5.3, sellRate: 5.3012, quotedAt: '2026-11-19T16:04:28.123Z', quoteDate: '2026-11-19' });
    expect(fetchFn.calls).toEqual(['11-19-2026']);
  });

  test('antes da publicação (value vazio) recua para ontem', async () => {
    const fetchFn = fakeFetch({ '11-18-2026': { value: [row({ dataHoraCotacao: '2026-11-18 13:05:00.000' })] } });
    const quote = await fetchLatestPtax({ fetchFn, now: THURSDAY });
    expect(quote.quoteDate).toBe('2026-11-18');
    expect(fetchFn.calls).toEqual(['11-19-2026', '11-18-2026']);
  });

  test('domingo: pula sábado e domingo sem chamar a API e usa a sexta', async () => {
    const fetchFn = fakeFetch({ '11-20-2026': { value: [row({ dataHoraCotacao: '2026-11-20 13:05:00.000' })] } });
    const quote = await fetchLatestPtax({ fetchFn, now: new Date('2026-11-22T15:00:00.000Z') });
    expect(quote.quoteDate).toBe('2026-11-20');
    expect(fetchFn.calls).toEqual(['11-20-2026']);
  });

  test('segunda sem cotação (feriado): recua para a sexta pulando o fim de semana', async () => {
    const fetchFn = fakeFetch({ '11-13-2026': { value: [row({ dataHoraCotacao: '2026-11-13 13:05:00.000' })] } });
    const quote = await fetchLatestPtax({ fetchFn, now: new Date('2026-11-16T15:00:00.000Z') });
    expect(quote.quoteDate).toBe('2026-11-13');
    expect(fetchFn.calls).toEqual(['11-16-2026', '11-13-2026']);
  });

  test('sem cotação em nenhum dia → PTAX_NOT_FOUND', async () => {
    const fetchFn = fakeFetch({});
    await expect(fetchLatestPtax({ fetchFn, now: THURSDAY })).rejects.toEqual(code('PTAX_NOT_FOUND'));
    expect(fetchFn.calls).toHaveLength(6);
  });

  test('virada UTC: 02:00Z consulta o dia de Brasília', async () => {
    const fetchFn = fakeFetch({ '11-19-2026': { value: [row()] } });
    await fetchLatestPtax({ fetchFn, now: new Date('2026-11-20T02:00:00.000Z') });
    expect(fetchFn.calls).toEqual(['11-19-2026']);
  });

  test('HTTP 500 → PTAX_FETCH_FAILED', async () => {
    const fetchFn = async () => ({ ok: false, status: 500, text: async () => 'erro' });
    await expect(fetchLatestPtax({ fetchFn, now: THURSDAY })).rejects.toEqual(code('PTAX_FETCH_FAILED'));
  });

  test('rede que lança → PTAX_FETCH_FAILED', async () => {
    const fetchFn = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(fetchLatestPtax({ fetchFn, now: THURSDAY })).rejects.toEqual(code('PTAX_FETCH_FAILED'));
  });

  test('sem fetch disponível → PTAX_FETCH_FAILED', async () => {
    await expect(fetchLatestPtax({ fetchFn: null, now: THURSDAY })).rejects.toEqual(code('PTAX_FETCH_FAILED'));
  });

  test('JSON inválido → PTAX_INVALID_RESPONSE', async () => {
    const fetchFn = async () => ({ ok: true, status: 200, text: async () => '<html>' });
    await expect(fetchLatestPtax({ fetchFn, now: THURSDAY })).rejects.toEqual(code('PTAX_INVALID_RESPONSE'));
  });

  test('valor fora de 1..50 → PTAX_INVALID_RESPONSE', async () => {
    const fetchFn = fakeFetch({ '11-19-2026': { value: [row({ cotacaoVenda: 530 })] } });
    await expect(fetchLatestPtax({ fetchFn, now: THURSDAY })).rejects.toEqual(code('PTAX_INVALID_RESPONSE'));
  });

  test('resposta acima de 64 KB → PTAX_INVALID_RESPONSE', async () => {
    const big = JSON.stringify({ value: [row()], padding: 'x'.repeat(65 * 1024) });
    const fetchFn = async () => ({ ok: true, status: 200, text: async () => big });
    await expect(fetchLatestPtax({ fetchFn, now: THURSDAY })).rejects.toEqual(code('PTAX_INVALID_RESPONSE'));
  });

  test('Content-Length acima de 64 KB é recusado sem ler o corpo', async () => {
    const text = jest.fn();
    const fetchFn = async () => ({ ok: true, status: 200, headers: { get: () => String(70 * 1024) }, text });
    await expect(fetchLatestPtax({ fetchFn, now: THURSDAY })).rejects.toEqual(code('PTAX_INVALID_RESPONSE'));
    expect(text).not.toHaveBeenCalled();
  });

  test('corpo em stream acima de 64 KB é interrompido', async () => {
    let cancelled = false;
    const chunk = new Uint8Array(40 * 1024);
    let sent = 0;
    const body = {
      getReader: () => ({
        read: async () => (sent++ < 5 ? { done: false, value: chunk } : { done: true }),
        cancel: async () => {
          cancelled = true;
        },
      }),
    };
    const fetchFn = async () => ({ ok: true, status: 200, body });
    await expect(fetchLatestPtax({ fetchFn, now: THURSDAY })).rejects.toEqual(code('PTAX_INVALID_RESPONSE'));
    expect(cancelled).toBe(true);
  });

  test('corpo em stream pequeno é lido', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ value: [row()] }));
    let done = false;
    const body = { getReader: () => ({ read: async () => (done ? { done: true } : ((done = true), { done: false, value: bytes })) }) };
    const fetchFn = async () => ({ ok: true, status: 200, body });
    expect((await fetchLatestPtax({ fetchFn, now: THURSDAY })).sellRate).toBe(5.3012);
  });

  test('timeout por chamada (fetch que nunca responde) → PTAX_FETCH_FAILED e o sinal é abortado', async () => {
    let signal;
    const fetchFn = (url, opts) => {
      signal = opts.signal;
      return new Promise(() => {});
    };
    await expect(fetchLatestPtax({ fetchFn, now: THURSDAY, callTimeoutMs: 30 })).rejects.toEqual(code('PTAX_FETCH_FAILED'));
    expect(signal.aborted).toBe(true);
  });

  test('timeout total encerra a série de chamadas lentas', async () => {
    const fetchFn = jest.fn(
      () => new Promise((resolve) => setTimeout(() => resolve(okResponse({ value: [] })), 40))
    );
    await expect(
      fetchLatestPtax({ fetchFn, now: THURSDAY, callTimeoutMs: 1000, totalTimeoutMs: 100 })
    ).rejects.toEqual(code('PTAX_FETCH_FAILED'));
    expect(fetchFn.mock.calls.length).toBeLessThan(6);
  });
});
