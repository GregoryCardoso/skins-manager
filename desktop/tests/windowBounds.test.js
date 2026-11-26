'use strict';

const { computeInitialBounds } = require('../src/lib/windowBounds');

describe('computeInitialBounds', () => {
  test('sem área útil informada usa o tamanho preferido', () => {
    expect(computeInitialBounds()).toEqual({ width: 1280, height: 800 });
    expect(computeInitialBounds({ workArea: null })).toEqual({ width: 1280, height: 800 });
  });

  test('tela grande: o preferido', () => {
    expect(computeInitialBounds({ workArea: { width: 2560, height: 1400 } })).toEqual({ width: 1280, height: 800 });
  });

  test('nunca maior que a área útil', () => {
    expect(computeInitialBounds({ workArea: { width: 1366, height: 728 } })).toEqual({ width: 1280, height: 728 });
    expect(computeInitialBounds({ workArea: { width: 1000, height: 650.7 } })).toEqual({ width: 1000, height: 650 });
  });

  test('nunca menor que o mínimo 800x600', () => {
    expect(computeInitialBounds({ workArea: { width: 640, height: 480 } })).toEqual({ width: 800, height: 600 });
  });

  test('valores inválidos na área útil são ignorados', () => {
    expect(computeInitialBounds({ workArea: { width: NaN, height: 0 } })).toEqual({ width: 1280, height: 800 });
  });

  test('preferido e mínimo podem ser trocados', () => {
    expect(computeInitialBounds({ workArea: { width: 900, height: 900 }, preferred: { width: 1000, height: 500 }, min: { width: 400, height: 300 } })).toEqual({ width: 900, height: 500 });
  });
});
