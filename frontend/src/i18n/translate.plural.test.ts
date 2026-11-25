import { describe, expect, test } from 'vitest';
import en from './en.json';
import ptBR from './pt-BR.json';
import { translate, translatePlural } from './translate';

const RU = { n: { one: '{count} предмет', few: '{count} предмета', many: '{count} предметов', other: '{count} предмета (дробь)' } };
const ZH = { n: { other: '{count} 件' } };
const FR = { n: { one: '{count} objet', other: '{count} objets' } };
const PL = { n: { one: '{count} przedmiot', few: '{count} przedmioty', many: '{count} przedmiotów', other: '{count} przedmiotu' } };

describe('translatePlural pelo Intl.PluralRules (D369)', () => {
  test.each([
    [0, '0 предметов'], [1, '1 предмет'], [2, '2 предмета'], [4, '4 предмета'], [5, '5 предметов'], [11, '11 предметов'],
    [12, '12 предметов'], [21, '21 предмет'], [22, '22 предмета'], [25, '25 предметов'], [101, '101 предмет'], [111, '111 предметов'],
  ])('russo: %p', (count, expected) => {
    expect(translatePlural(RU, 'n', count, 'ru')).toBe(expected);
  });

  test.each([[0, '0 przedmiotów'], [1, '1 przedmiot'], [2, '2 przedmioty'], [5, '5 przedmiotów'], [12, '12 przedmiotów'], [22, '22 przedmioty'], [25, '25 przedmiotów']])(
    'polonês: %p', (count, expected) => {
      expect(translatePlural(PL, 'n', count, 'pl')).toBe(expected);
    },
  );

  test('ucraniano usa one/few/many como o russo', () => {
    const uk = { n: { one: 'um {count}', few: 'poucos {count}', many: 'muitos {count}', other: 'outros {count}' } };
    expect([1, 2, 5, 21, 22, 25].map((n) => translatePlural(uk, 'n', n, 'uk'))).toEqual(['um 1', 'poucos 2', 'muitos 5', 'um 21', 'poucos 22', 'muitos 25']);
  });

  test('chinês, japonês e coreano só têm other', () => {
    for (const locale of ['zh-CN', 'ja', 'ko']) {
      expect([0, 1, 2, 5].map((n) => translatePlural(ZH, 'n', n, locale))).toEqual(['0 件', '1 件', '2 件', '5 件']);
    }
  });

  test('francês: 0 e 1 no singular; a forma many (milhões) cai em other quando o dicionário não a tem', () => {
    expect(translatePlural(FR, 'n', 0, 'fr')).toBe('0 objet');
    expect(translatePlural(FR, 'n', 1, 'fr')).toBe('1 objet');
    expect(translatePlural(FR, 'n', 2, 'fr')).toBe('2 objets');
    expect(translatePlural(FR, 'n', 1_000_000, 'fr')).toBe('1000000 objets');
  });

  test('en e pt-BR continuam iguais: one para 1 e other nos demais', () => {
    expect(translatePlural(en, 'sales.count', 1, 'en')).toBe(translate(en, 'sales.count.one', { count: 1 }));
    expect(translatePlural(en, 'sales.count', 3, 'en')).toBe(translate(en, 'sales.count.other', { count: 3 }));
    expect(translatePlural(ptBR, 'sales.count', 1, 'pt-BR')).toBe(translate(ptBR, 'sales.count.one', { count: 1 }));
    expect(translatePlural(ptBR, 'sales.count', 1_000_000, 'pt-BR')).toBe(translate(ptBR, 'sales.count.other', { count: 1_000_000 }));
  });

  test('categorias zero, two, few e many quando o idioma as tem e o dicionário também', () => {
    const ar = { n: { zero: 'nenhum', one: 'um', two: 'dois', few: 'poucos', many: 'muitos', other: 'outros' } };
    expect([0, 1, 2, 3, 11, 100].map((n) => translatePlural(ar, 'n', n, 'ar'))).toEqual(['nenhum', 'um', 'dois', 'poucos', 'muitos', 'outros']);
  });

  test('parâmetros extras e {count}', () => {
    const dict = { n: { one: '{count} de {total}', other: '{count} de {total}' } };
    expect(translatePlural(dict, 'n', 2, 'en', { total: 9 })).toBe('2 de 9');
  });

  test('plural ausente no idioma cai no texto em inglês, com as regras do inglês', () => {
    expect(translatePlural({}, 'sales.count', 1, 'ru', undefined, en)).toBe(translate(en, 'sales.count.one', { count: 1 }));
    expect(translatePlural({}, 'sales.count', 5, 'ru', undefined, en)).toBe(translate(en, 'sales.count.other', { count: 5 }));
  });

  test('plural ausente em tudo: devolve a chave', () => {
    expect(translatePlural({}, 'nada.aqui', 2, 'en', undefined, {})).toBe('nada.aqui.other');
  });
});

describe('translate com o inglês como reserva (D369)', () => {
  test('chave ausente no idioma mostra o texto em inglês, e não a chave', () => {
    expect(translate({}, 'nav.sales', undefined, en)).toBe(en.nav.sales);
    expect(translate({ nav: {} }, 'nav.sales', undefined, en)).toBe(en.nav.sales);
  });
  test('o texto do idioma tem prioridade sobre o inglês', () => {
    expect(translate(ptBR, 'nav.sales', undefined, en)).toBe(ptBR.nav.sales);
  });
  test('reserva também interpola', () => {
    expect(translate({}, 'catalog.total', { total: 5 }, en)).toBe(translate(en, 'catalog.total', { total: 5 }));
  });
  test('ausente nos dois: devolve a chave', () => {
    expect(translate({}, 'nada.aqui', undefined, en)).toBe('nada.aqui');
  });
  test('sem reserva (chamada antiga) devolve a chave', () => {
    expect(translate({}, 'nav.sales')).toBe('nav.sales');
  });
});
