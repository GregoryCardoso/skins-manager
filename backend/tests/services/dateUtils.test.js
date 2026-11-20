const { parseDate, toIso, formatDateTimeBr } = require('../../src/services/dateUtils');

describe('dateUtils', () => {
  test('parseDate aceita Date e string; nulo/inválido -> INVALID_DATE com o rótulo', () => {
    expect(parseDate('2026-11-19T15:00:00Z').toISOString()).toBe('2026-11-19T15:00:00.000Z');
    expect(parseDate(new Date(0)).getTime()).toBe(0);
    for (const v of [null, undefined, 'x', new Date('x'), 5]) {
      expect(() => parseDate(v, 'Data de venda')).toThrow(expect.objectContaining({ code: 'INVALID_DATE', message: 'Data de venda inválida.' }));
    }
  });

  test('toIso normaliza o fuso para UTC', () => {
    expect(toIso('2026-11-10T09:00:00-03:00')).toBe('2026-11-10T12:00:00.000Z');
  });

  describe('formatDateTimeBr', () => {
    test('dd/mm/aaaa HH:mm em Brasília, sem vírgula e sem segundos', () => {
      expect(formatDateTimeBr('2026-11-21T15:00:45.000Z')).toBe('21/11/2026 12:00');
    });
    test('24 h (meia-noite é 00:00, tarde é 15:xx)', () => {
      expect(formatDateTimeBr('2026-11-21T03:00:00Z')).toBe('21/11/2026 00:00');
      expect(formatDateTimeBr('2026-11-21T18:30:00Z')).toBe('21/11/2026 15:30');
      expect(formatDateTimeBr('2026-11-21T23:59:00Z')).not.toMatch(/[,APM]/);
    });
    test('virada de dia de UTC para Brasília', () => {
      expect(formatDateTimeBr('2026-11-21T02:30:00Z')).toBe('20/11/2026 23:30');
      expect(formatDateTimeBr('2027-01-01T01:00:00Z')).toBe('31/12/2026 22:00');
    });
    test('data inválida -> INVALID_DATE', () => {
      expect(() => formatDateTimeBr(null)).toThrow(expect.objectContaining({ code: 'INVALID_DATE' }));
    });
  });

  describe('anos 0000-0099', () => {
    test.each(['0050-03-01T00:00:00Z', '0099-12-31T00:00:00Z', '0000-01-01T00:00:00Z'])('%s mantém o ano', (v) => {
      expect(parseDate(v).toISOString()).toBe(v.replace('Z', '.000Z'));
    });
    test('0050-02-29 é inválido (não bissexto) e 0000-02-29 é válido', () => {
      expect(() => parseDate('0050-02-29T00:00:00Z')).toThrow(expect.objectContaining({ code: 'INVALID_DATE' }));
      expect(parseDate('0000-02-29T00:00:00Z').getUTCFullYear()).toBe(0);
    });
  });
});
