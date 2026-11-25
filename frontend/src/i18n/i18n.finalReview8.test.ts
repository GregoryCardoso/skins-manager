import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate } from '@/i18n/translate';

// Revisão final da Etapa 8: chaves novas do resumo (linhas "indisponível" e dica do lucro real).
const keys = [
  'profit.summary.pendingUnavailable', 'profit.summary.realProfitHint',
  'profit.summary.unavailable', 'profit.summary.unavailableHint',
];
const holders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]);
}

describe('paridade das chaves da revisão final da Etapa 8', () => {
  test.each(keys)('%s existe, não vazia, nos dois idiomas com os mesmos marcadores', (key) => {
    const pt = translate(ptBR, key);
    const enText = translate(en, key);
    expect(pt).not.toBe(key);
    expect(enText).not.toBe(key);
    expect(pt.trim()).not.toBe('');
    expect(enText.trim()).not.toBe('');
    expect(holders(enText)).toEqual(holders(pt));
  });

  test('realProfitHint cita o saldo calculado e o pendente nos dois idiomas (sem o liberado, D245)', () => {
    expect(translate(ptBR, 'profit.summary.realProfitHint').toLowerCase()).toMatch(/pendente/);
    expect(translate(ptBR, 'profit.summary.realProfitHint').toLowerCase()).toMatch(/saldo das lojas/);
    expect(translate(en, 'profit.summary.realProfitHint').toLowerCase()).toMatch(/pending/);
    expect(translate(en, 'profit.summary.realProfitHint').toLowerCase()).toMatch(/store balances/);
  });

  test('as linhas indisponível citam a cotação do dólar', () => {
    for (const key of ['profit.summary.pendingUnavailable']) {
      expect(translate(ptBR, key).toLowerCase()).toMatch(/cotação/);
      expect(translate(en, key).toLowerCase()).toMatch(/rate/);
    }
  });

  test('a seção profit tem exatamente as mesmas chaves em pt-BR e en', () => {
    const pt = flatten((ptBR as Record<string, unknown>).profit as Record<string, unknown>).sort();
    const enKeys = flatten((en as Record<string, unknown>).profit as Record<string, unknown>).sort();
    expect(enKeys).toEqual(pt);
  });
});
