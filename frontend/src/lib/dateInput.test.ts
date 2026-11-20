import { describe, expect, test } from 'vitest';
import {
  addDaysToLocalInput, dateToLocalInput, isoToLocalInput, localInputToDate, localInputToIso, nowLocalInput,
} from './dateInput';

describe('dateInput', () => {
  test('vazio e inválido -> null / vazio', () => {
    expect(localInputToIso('')).toBeNull();
    expect(localInputToIso('ontem')).toBeNull();
    expect(localInputToIso('2026-02-30T10:00')).toBeNull();
    expect(localInputToDate('2026-13-01T10:00')).toBeNull();
    expect(isoToLocalInput(null)).toBe('');
    expect(isoToLocalInput('lixo')).toBe('');
  });

  test('ISO gerado tem offset e representa o mesmo instante local', () => {
    const iso = localInputToIso('2026-11-20T14:30');
    expect(iso).toMatch(/^2026-11-20T14:30:00[+-]\d{2}:\d{2}$/);
    expect(new Date(iso as string).getTime()).toBe(new Date(2026, 10, 20, 14, 30).getTime());
  });

  test('ida e volta preserva o valor digitado', () => {
    for (const text of ['2026-11-20T14:30', '2026-01-01T00:00', '2026-12-31T23:59', '2026-03-08T02:30']) {
      expect(isoToLocalInput(localInputToIso(text))).toBe(text);
    }
  });

  test('isoToLocalInput converte UTC para a hora local', () => {
    const date = new Date(2026, 10, 20, 9, 5);
    expect(isoToLocalInput(date.toISOString())).toBe('2026-11-20T09:05');
  });

  test('nowLocalInput e addDaysToLocalInput', () => {
    const now = new Date(2026, 10, 20, 9, 5, 42);
    expect(nowLocalInput(now)).toBe('2026-11-20T09:05');
    expect(dateToLocalInput(now)).toBe('2026-11-20T09:05');
    expect(addDaysToLocalInput('2026-11-20T09:05', 7)).toBe('2026-11-27T09:05');
    expect(addDaysToLocalInput('2026-12-28T10:00', 7)).toBe('2027-01-04T10:00');
    expect(addDaysToLocalInput('', 7, now)).toBe('2026-11-27T09:05');
  });
});
