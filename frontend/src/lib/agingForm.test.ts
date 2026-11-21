import { describe, expect, test } from 'vitest';
import { agingStateFromSettings, buildAgingPatch, hasAgingChanges, restoreDefaultPatch } from './agingForm';

const settings = { fastTurnoverDays: 7, slowItemDays: 21 };

describe('agingForm (D159)', () => {
  test('o estado inicial mostra os valores efetivos', () => {
    expect(agingStateFromSettings(settings)).toEqual({ fastText: '7', slowText: '21' });
  });

  test('sem mudança: patch vazio', () => {
    const r = buildAgingPatch({ fastText: '7', slowText: '21' }, settings);
    expect(r).toEqual({ ok: true, patch: {} });
    expect(r.ok && hasAgingChanges(r.patch)).toBe(false);
  });

  test('só o campo alterado é enviado', () => {
    expect(buildAgingPatch({ fastText: '5', slowText: '21' }, settings)).toEqual({ ok: true, patch: { fastTurnoverDays: 5 } });
    expect(buildAgingPatch({ fastText: '7', slowText: '30' }, settings)).toEqual({ ok: true, patch: { slowItemDays: 30 } });
    expect(buildAgingPatch({ fastText: '3', slowText: '30' }, settings)).toEqual({
      ok: true, patch: { fastTurnoverDays: 3, slowItemDays: 30 },
    });
  });

  test.each(['', 'abc', '1.5', '-3', '7,5', ' '])('texto %j é inválido no campo', (text) => {
    expect(buildAgingPatch({ fastText: text, slowText: '21' }, settings)).toEqual({
      ok: false, errors: { fastTurnoverDays: 'settings.aging.invalidNumber' },
    });
    expect(buildAgingPatch({ fastText: '7', slowText: text }, settings)).toEqual({
      ok: false, errors: { slowItemDays: 'settings.aging.invalidNumber' },
    });
  });

  test('valores fora da faixa seguem para o backend validar', () => {
    expect(buildAgingPatch({ fastText: '0', slowText: '999' }, settings)).toEqual({
      ok: true, patch: { fastTurnoverDays: 0, slowItemDays: 999 },
    });
  });

  test('restaurar o padrão envia null só para o campo', () => {
    expect(restoreDefaultPatch('fastTurnoverDays')).toEqual({ fastTurnoverDays: null });
    expect(restoreDefaultPatch('slowItemDays')).toEqual({ slowItemDays: null });
  });
});
