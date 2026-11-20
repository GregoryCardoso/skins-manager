'use strict';

const deducted = require('../../../src/services/fees/deductedSaleFee');
const { computeSaleFee } = require('../../../src/services/fees');
const { CSF } = require('../../helpers/storeFixtures');

describe('Strategy DEDUCTED — testes obrigatórios da CSFloat (C1–C4)', () => {
  test.each([
    ['C1', 3, 1, 2],
    ['C2', 120, 3, 117],
    ['C3', 125, 3, 122],
    ['C4', 130, 3, 127],
  ])('%s: preço %i → taxa %i (líquido %i)', (_id, price, fee, net) => {
    expect(computeSaleFee(price, CSF)).toBe(fee);
    expect(deducted.fee(price, CSF)).toBe(fee);
    expect(deducted.net(price, CSF)).toBe(net);
  });
});

describe('Strategy DEDUCTED — demais casos', () => {
  test('type = DEDUCTED', () => {
    expect(deducted.type).toBe('DEDUCTED');
  });

  test('minFeeCents 5: fee(100) = 5', () => {
    expect(computeSaleFee(100, { ...CSF, minFeeCents: 5 })).toBe(5);
  });

  test('fixedFeeCents 10: fee(120) = 13', () => {
    expect(computeSaleFee(120, { ...CSF, fixedFeeCents: 10 })).toBe(13);
  });

  test('net pode ser negativo (taxa maior que o preço)', () => {
    expect(deducted.net(3, { ...CSF, minFeeCents: 5 })).toBe(-2);
  });

  test.each([
    ['CSF', CSF],
    ['com minFee 5', { ...CSF, minFeeCents: 5 }],
    ['com fixa 10', { ...CSF, fixedFeeCents: 10 }],
    ['ROUND', { ...CSF, rounding: 'ROUND' }],
    ['FLOOR', { ...CSF, rounding: 'FLOOR' }],
  ])('estimateGross nunca passa do mínimo real + 2 (%s, alvo 0..2000)', (_label, params) => {
    let g = 1;
    for (let target = 0; target <= 2000; target += 1) {
      while (deducted.net(g, params) < target) g += 1; // mínimo real por força bruta (net não decrescente)
      expect(deducted.estimateGross(target, params)).toBeLessThanOrEqual(g + 2);
    }
  });

  test('net não decrescente de 1 a 2000', () => {
    let prev = deducted.net(1, CSF);
    for (let g = 2; g <= 2000; g += 1) {
      const cur = deducted.net(g, CSF);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });
});
