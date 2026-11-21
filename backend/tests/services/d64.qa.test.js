// QA independente de D64 (itens 1 e 2) nas funções puras, sem validador nem banco.
const fs = require('fs');
const path = require('path');
const itemService = require('../../src/services/itemService');

const { buildSaleRecord } = itemService;
// T31: `body` é obrigatório; `{}` equivale a "nada além do estado mesclado foi enviado".
const buildItemRecord = (merged, ctx = {}) => itemService.buildItemRecord(merged, { body: {}, ...ctx });
const { assertNotFutureDay, assertAcquiredAtNotFuture, daysBetween } = require('../../src/services/inventoryAgingService');
const { parseDate, toIso } = require('../../src/services/dateUtils');
const { MAX_AMOUNT_CENTS } = require('../../src/config/constants');
const { csfloat, csmoney } = require('../helpers/storeFixtures');

const NOW = new Date('2026-11-19T15:00:00.000Z'); // 12:00 BRT
const SETTINGS = { usdBrlRate: 5 };
const OPTS = { code: 'FUTURE', message: 'futuro' };

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return undefined;
}

const purchase = (o = {}) => ({
  name: 'AK-47 | Redline', category: 'SKIN', acquisitionType: 'COMPRA', purchaseStoreId: 1, purchasePriceCents: 100,
  acquiredAt: '2026-11-10T12:00:00.000Z', ...o,
});
const stockItem = { id: 1, acquiredAt: '2026-11-01T00:00:00.000Z', tradeUnlockAt: null, status: 'EM_ESTOQUE' };
const saleInput = (p, o = {}) => ({ salePriceCents: p, soldAt: '2026-11-10T12:00:00.000Z', ...o });

describe('D64.1 MAX_AMOUNT_CENTS em buildItemRecord', () => {
  const ctx = { store: csfloat(), settings: SETTINGS, now: NOW };

  test('priceInformed padrão (POST): teto aceito, teto+1 recusado', () => {
    expect(buildItemRecord(purchase({ purchasePriceCents: MAX_AMOUNT_CENTS }), ctx).purchasePriceCents).toBe(MAX_AMOUNT_CENTS);
    expect(codeOf(() => buildItemRecord(purchase({ purchasePriceCents: MAX_AMOUNT_CENTS + 1 }), ctx))).toBe('INVALID_AMOUNT');
  });

  test('GANHEI com preço no corpo (mesmo acima do teto) é recusado por GANHEI_COST_NOT_ALLOWED (D65)', () => {
    const won = { name: 'x', category: 'CAIXA', acquisitionType: 'GANHEI', purchasePriceCents: MAX_AMOUNT_CENTS + 1 };
    expect(codeOf(() => buildItemRecord(won, { store: null, settings: SETTINGS, now: NOW, body: won }))).toBe('GANHEI_COST_NOT_ALLOWED');
  });

  test('edição sem preço informado preserva o legado; reenviar o mesmo legado (priceInformed) é recusado', () => {
    const legacy = 5e12;
    const existing = { ...purchase({ purchasePriceCents: legacy }), purchaseCurrency: 'USD', status: 'EM_ESTOQUE' };
    const merged = purchase({ purchasePriceCents: legacy, name: 'Renomeado' });
    expect(buildItemRecord(merged, { ...ctx, existing, priceInformed: false }).purchasePriceCents).toBe(legacy);
    expect(codeOf(() => buildItemRecord(merged, { ...ctx, existing, priceInformed: true }))).toBe('INVALID_AMOUNT');
  });
});

describe('D64.1 MAX_AMOUNT_CENTS em buildSaleRecord', () => {
  test('recusa antes de computeSale: loja sem taxas dá INVALID_AMOUNT (não FEES_NOT_CONFIGURED)', () => {
    const ctx = { store: csmoney(), settings: SETTINGS, now: NOW };
    expect(codeOf(() => buildSaleRecord(stockItem, saleInput(MAX_AMOUNT_CENTS + 1), ctx))).toBe('INVALID_AMOUNT');
    // no teto chega ao computeSale, que acusa a falta de taxas
    expect(codeOf(() => buildSaleRecord(stockItem, saleInput(MAX_AMOUNT_CENTS), ctx))).toBe('FEES_NOT_CONFIGURED');
  });

  test('recusa antes de resolver a cotação (USD com fxRate informado)', () => {
    const ctx = { store: csfloat(), settings: SETTINGS, now: NOW };
    expect(codeOf(() => buildSaleRecord(stockItem, saleInput(MAX_AMOUNT_CENTS + 1, { fxRateAtSale: 5 }), ctx))).toBe('INVALID_AMOUNT');
  });

  test('valor não inteiro seguro (1e20) também é recusado', () => {
    const ctx = { store: csfloat(), settings: SETTINGS, now: NOW };
    expect(codeOf(() => buildSaleRecord(stockItem, saleInput(1e20), ctx))).toBe('INVALID_AMOUNT');
  });
});

describe('D64.2 assertNotFutureDay: anos < 1000 comparados como números', () => {
  test.each(['0999-12-31T23:59:59Z', '0100-01-01T00:00:00Z', '0050-06-15T12:00:00Z', '0001-01-01T12:00:00Z'])(
    '%s é passado',
    (d) => {
      expect(() => assertNotFutureDay(parseDate(d), NOW, OPTS)).not.toThrow();
      expect(() => assertAcquiredAtNotFuture(d, NOW)).not.toThrow();
    }
  );

  test('ano 0000 (02-29) é passado', () => {
    expect(() => assertAcquiredAtNotFuture('0000-02-29T12:00:00Z', NOW)).not.toThrow();
  });

  test('now num ano < 1000 também compara corretamente (data de 0999 vs now de 0100 é futura)', () => {
    const now = parseDate('0100-06-01T15:00:00Z');
    expect(codeOf(() => assertNotFutureDay(parseDate('0999-01-01T15:00:00Z'), now, OPTS))).toBe('FUTURE');
    expect(codeOf(() => assertNotFutureDay(parseDate('0100-06-02T15:00:00Z'), now, OPTS))).toBe('FUTURE');
    expect(() => assertNotFutureDay(parseDate('0100-06-01T20:00:00Z'), now, OPTS)).not.toThrow();
  });

  test('ano 9999 é futuro', () => {
    expect(codeOf(() => assertAcquiredAtNotFuture('9999-01-01T00:00:00Z', NOW))).toBe('ACQUIRED_AT_IN_FUTURE');
  });
});

describe('D64.2 fronteiras do dia civil em São Paulo', () => {
  test('23:59:59.999 BRT de hoje aceito; 00:00 BRT de amanhã recusado (UTC já virado)', () => {
    expect(() => assertNotFutureDay(parseDate('2026-11-20T02:59:59.999Z'), NOW, OPTS)).not.toThrow();
    expect(() => assertNotFutureDay(parseDate('2026-11-19T23:59:59.999-03:00'), NOW, OPTS)).not.toThrow();
    expect(codeOf(() => assertNotFutureDay(parseDate('2026-11-20T03:00:00.000Z'), NOW, OPTS))).toBe('FUTURE');
    expect(codeOf(() => assertNotFutureDay(parseDate('2026-11-20T00:00:00-03:00'), NOW, OPTS))).toBe('FUTURE');
  });

  test('now às 23:30 BRT (UTC já no dia seguinte)', () => {
    const now = parseDate('2026-11-20T02:30:00Z');
    expect(() => assertNotFutureDay(parseDate('2026-11-20T02:59:59.999Z'), now, OPTS)).not.toThrow();
    expect(codeOf(() => assertNotFutureDay(parseDate('2026-11-20T03:00:00Z'), now, OPTS))).toBe('FUTURE');
  });

  test('virada de mês e de ano', () => {
    const now = parseDate('2027-01-01T02:00:00Z'); // 31/12/2026 23:00 BRT
    expect(() => assertNotFutureDay(parseDate('2026-12-31T23:59:59.999-03:00'), now, OPTS)).not.toThrow();
    expect(codeOf(() => assertNotFutureDay(parseDate('2027-01-01T03:00:00Z'), now, OPTS))).toBe('FUTURE');
    const now2 = parseDate('2026-12-01T02:00:00Z'); // 30/11 23:00 BRT
    expect(codeOf(() => assertNotFutureDay(parseDate('2026-12-01T03:00:00Z'), now2, OPTS))).toBe('FUTURE');
  });
});

describe('D64.2 parseDate com anos 0000–0099', () => {
  test('0000-02-29 válido (ano 0 bissexto) e não mapeado para 1900', () => {
    const d = parseDate('0000-02-29T12:00:00Z');
    expect(d.getUTCFullYear()).toBe(0);
    expect(d.getUTCMonth()).toBe(1);
    expect(d.getUTCDate()).toBe(29);
    expect(toIso('0000-02-29T12:00:00Z')).toBe('0000-02-29T12:00:00.000Z');
  });

  test.each(['0050-02-29T00:00:00Z', '0001-02-29T00:00:00Z', '0099-02-29T00:00:00Z', '0100-02-29T00:00:00Z'])(
    '%s inválido',
    (d) => expect(codeOf(() => parseDate(d))).toBe('INVALID_DATE')
  );

  test.each([
    ['0004-02-29T00:00:00Z', 4],
    ['0050-02-28T00:00:00Z', 50],
    ['0099-12-31T23:59:59Z', 99],
    ['0400-02-29T00:00:00Z', 400],
  ])('%s válido com ano %d', (d, year) => {
    expect(parseDate(d).getUTCFullYear()).toBe(year);
  });

  test('ano 0050 com offset: o instante é calculado no ano 50, não 1950', () => {
    expect(toIso('0050-06-15T21:00:00-03:00')).toBe('0050-06-16T00:00:00.000Z');
  });

  test('daysBetween entre anos < 100 funciona', () => {
    expect(daysBetween('0050-01-01T00:00:00Z', '0050-01-11T00:00:00Z')).toBe(10);
  });
});

describe('D64.2 nenhuma comparação de datas como texto em src', () => {
  test('sem localeCompare nem comparação relacional entre strings de data/ISO', () => {
    const dir = path.join(__dirname, '../../src');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const suspicious = [];
    for (const file of walk(dir).filter((f) => f.endsWith('.js'))) {
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (/^\s*\/\//.test(line)) return;
        if (/localeCompare/.test(line)) suspicious.push(`${file}:${i + 1}`);
        if (/(toISOString\(\)|toIso\([^)]*\)|toSaoPauloDate\([^)]*\)|\w+At)\s*[<>]=?\s*[\w'"`]/.test(line)) {
          suspicious.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(suspicious).toEqual([]);
  });
});
