'use strict';

const added = require('../../../src/services/fees/addedSaleFee');
const { computeSaleFee } = require('../../../src/services/fees');
const { STEAM_PARAMS } = require('../../helpers/storeFixtures');

describe('Strategy ADDED (Steam 0.15 CEIL)', () => {
  test('type = ADDED', () => {
    expect(added.type).toBe('ADDED');
  });

  test('fee(100) = 15', () => {
    expect(computeSaleFee(100, STEAM_PARAMS)).toBe(15);
    expect(added.fee(100, STEAM_PARAMS)).toBe(15);
  });

  test('estimateGross(100) = 115', () => {
    expect(added.estimateGross(100, STEAM_PARAMS)).toBe(115);
  });

  test('net(115) = 100', () => {
    expect(added.net(115, STEAM_PARAMS)).toBe(100);
  });

  test('net(116) = 100', () => {
    expect(added.net(116, STEAM_PARAMS)).toBe(100);
  });

  test('net(1) = 0', () => {
    expect(added.net(1, STEAM_PARAMS)).toBe(0);
  });

  test('nenhum recebido cabe → g − fee(0) (negativo)', () => {
    expect(added.net(3, { ...STEAM_PARAMS, fixedFeeCents: 5 })).toBe(-2);
  });

  test('net não decrescente de 1 a 2000 e é o maior r com r + fee(r) <= g', () => {
    let prev = added.net(1, STEAM_PARAMS);
    for (let g = 1; g <= 2000; g += 1) {
      const r = added.net(g, STEAM_PARAMS);
      expect(r).toBeGreaterThanOrEqual(prev);
      expect(r + added.fee(r, STEAM_PARAMS)).toBeLessThanOrEqual(g);
      expect(r + 1 + added.fee(r + 1, STEAM_PARAMS)).toBeGreaterThan(g);
      prev = r;
    }
  });
});
