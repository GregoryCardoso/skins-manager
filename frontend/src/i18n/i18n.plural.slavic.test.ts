import { describe, expect, test } from 'vitest';
import pl from './pl.json';
import ru from './ru.json';
import tr from './tr.json';
import uk from './uk.json';
import { translatePlural } from './translate';

// 11.8: plurais de 4 formas (one/few/many/other) em ru, uk e pl; o turco só tem one/other, com o substantivo no singular.
const COUNTS = [1, 2, 5, 21, 22, 25, 1.5];
const row = (dict: unknown, key: string, locale: string) => COUNTS.map((n) => translatePlural(dict, key, n, locale));

describe('concordância de plural (11.8)', () => {
  test('ru: common.dayCount', () => {
    expect(row(ru, 'common.dayCount', 'ru')).toEqual(['1 день', '2 дня', '5 дней', '21 день', '22 дня', '25 дней', '1.5 дня']);
  });

  test('uk: common.dayCount', () => {
    expect(row(uk, 'common.dayCount', 'uk')).toEqual(['1 день', '2 дні', '5 днів', '21 день', '22 дні', '25 днів', '1.5 дня']);
  });

  test('pl: common.dayCount', () => {
    expect(row(pl, 'common.dayCount', 'pl')).toEqual(['1 dzień', '2 dni', '5 dni', '21 dni', '22 dni', '25 dni', '1.5 dnia']);
  });

  test('ru: sales.count', () => {
    expect(row(ru, 'sales.count', 'ru')).toEqual(['1 продажа', '2 продажи', '5 продаж', '21 продажа', '22 продажи', '25 продаж', '1.5 продажи']);
  });

  test('uk: sales.count', () => {
    expect(row(uk, 'sales.count', 'uk')).toEqual(['1 продаж', '2 продажі', '5 продажів', '21 продаж', '22 продажі', '25 продажів', '1.5 продажу']);
  });

  test('pl: sales.count', () => {
    expect(row(pl, 'sales.count', 'pl')).toEqual(['1 sprzedaż', '2 sprzedaże', '5 sprzedaży', '21 sprzedaży', '22 sprzedaże', '25 sprzedaży', '1.5 sprzedaży']);
  });

  test('ru, uk e pl: imports.counts.purchasesCreated concorda (1, 2, 5, 22)', () => {
    expect([1, 2, 5, 22].map((n) => translatePlural(ru, 'imports.counts.purchasesCreated', n, 'ru'))).toEqual([
      '1 покупка импортирована', '2 покупки импортированы', '5 покупок импортировано', '22 покупки импортированы',
    ]);
    expect([1, 2, 5, 22].map((n) => translatePlural(pl, 'imports.counts.purchasesCreated', n, 'pl'))).toEqual([
      '1 zakup zaimportowany', '2 zakupy zaimportowane', '5 zakupów zaimportowanych', '22 zakupy zaimportowane',
    ]);
    expect(translatePlural(uk, 'imports.counts.purchasesCreated', 5, 'uk')).toBe('Імпортовано покупок: 5');
  });

  test('zero vale em qualquer idioma que o tenha', () => {
    expect(translatePlural(ru, 'sales.count', 0, 'ru')).toBe('Нет продаж');
    expect(translatePlural(uk, 'sales.count', 0, 'uk')).toBe('Немає продажів');
    expect(translatePlural(pl, 'sales.count', 0, 'pl')).toBe('Brak sprzedaży');
    expect(translatePlural(tr, 'sales.count', 0, 'tr')).toBe('Satış yok');
  });

  test('tr: substantivo no singular depois do número, em qualquer contagem', () => {
    expect(row(tr, 'common.dayCount', 'tr')).toEqual(['1 gün', '2 gün', '5 gün', '21 gün', '22 gün', '25 gün', '1.5 gün']);
    expect(row(tr, 'sales.count', 'tr')).toEqual(['1 satış', '2 satış', '5 satış', '21 satış', '22 satış', '25 satış', '1.5 satış']);
    expect([1, 5].map((n) => translatePlural(tr, 'imports.counts.purchasesCreated', n, 'tr'))).toEqual(['1 alım içe aktarıldı', '5 alım içe aktarıldı']);
  });
});
