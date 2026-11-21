import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import {
  buildStoreCreateBody, buildStorePatchBody, initialStoreFormState, percentTextToRate, rateToPercentText,
  storeFormFromStore,
  validateStoreForm,
} from './storeForm';
import { makeStore } from './testFixtures';

describe('percentTextToRate: bordas', () => {
  test('ida e volta sem erro de ponto flutuante para todo percentual de 0,01 em 0,01 até 99,99', () => {
    for (let i = 0; i < 10000; i += 1) {
      const percent = i / 100;
      for (const lang of ['pt-BR', 'en']) {
        const text = percent.toLocaleString(lang, { useGrouping: false, maximumFractionDigits: 2 });
        const parsed = percentTextToRate(text, lang);
        expect(parsed, `${text} ${lang}`).toEqual({ ok: true, rate: Math.round(percent * 1e4) / 1e6 });
        expect(percentTextToRate(rateToPercentText((parsed as { rate: number }).rate, lang), lang)).toEqual(parsed);
      }
    }
  });

  test('0,5 -> 0.005, 15 -> 0.15, 2,5 -> 0.025 e o texto volta igual', () => {
    expect(percentTextToRate('0,5', 'pt-BR')).toEqual({ ok: true, rate: 0.005 });
    expect(percentTextToRate('15', 'pt-BR')).toEqual({ ok: true, rate: 0.15 });
    expect(percentTextToRate('2,5', 'pt-BR')).toEqual({ ok: true, rate: 0.025 });
    expect(rateToPercentText(0.005, 'pt-BR')).toBe('0,5');
    expect(rateToPercentText(0.005, 'en')).toBe('0.5');
    expect(rateToPercentText(0.15, 'en')).toBe('15');
    expect(rateToPercentText(0, 'pt-BR')).toBe('0');
    expect(rateToPercentText(0.999999, 'pt-BR')).toBe('99,9999');
  });

  test('entradas inválidas: letras, sinais, notação científica, símbolos, infinito', () => {
    for (const bad of ['abc', '1e2', '+5', '-0,5', '2,5%', '1,2,3', ',', '.', '100', '1000', 'Infinity', 'NaN', '0x10']) {
      expect(percentTextToRate(bad, 'pt-BR'), bad).toEqual({ ok: false });
    }
    expect(percentTextToRate('abc', 'en')).toEqual({ ok: false });
    expect(percentTextToRate('', 'en')).toEqual({ ok: true, rate: null });
  });
});

describe('formulário de loja: PATCH e bordas', () => {
  const store = makeStore({
    id: 5, name: 'Steam', currency: 'BRL', isPrimary: false, isActive: true, saleFeeType: 'ADDED', saleFeeRate: 0.15,
    saleMinFeeCents: null, saleFixedFeeCents: 0, withdrawalFeeRate: null, withdrawalFixedFeeCents: 0, allowsWithdrawal: false,
  });

  test('ida e volta sem editar não envia nada (null e 0 preservados), em pt-BR e en', () => {
    for (const lang of ['pt-BR', 'en']) {
      expect(buildStorePatchBody(storeFormFromStore(store, lang), store, lang)).toEqual({});
    }
  });

  test('limpar tipo e taxa envia os dois como null', () => {
    const state = storeFormFromStore(store, 'pt-BR');
    expect(buildStorePatchBody({ ...state, saleFeeType: '', saleFeeRateText: '' }, store, 'pt-BR'))
      .toEqual({ saleFeeType: null, saleFeeRate: null });
  });

  test('taxa 0 digitada é 0 e não null', () => {
    const state = storeFormFromStore(store, 'pt-BR');
    expect(buildStorePatchBody({ ...state, saleFeeRateText: '0' }, store, 'pt-BR')).toEqual({ saleFeeRate: 0 });
  });

  test('taxa fixa vazia vira 0; mínimo vazio vira null; mudar nome, moeda, ativo e principal', () => {
    const withFixed = makeStore({ ...store, saleFixedFeeCents: 30, saleMinFeeCents: 10 });
    const state = storeFormFromStore(withFixed, 'pt-BR');
    expect(state.saleFixedFeeText).toBe('0,30');
    expect(buildStorePatchBody({ ...state, saleFixedFeeText: '', saleMinFeeText: '' }, withFixed, 'pt-BR'))
      .toEqual({ saleFixedFeeCents: 0, saleMinFeeCents: null });
    expect(buildStorePatchBody({ ...state, name: ' Novo ', currency: 'USD', isActive: false, isPrimary: true }, withFixed, 'pt-BR'))
      .toEqual({ name: 'Novo', currency: 'USD', isActive: false, isPrimary: true });
  });

  test('estado vindo da loja principal não envia isPrimary (modal de edição sem checkbox)', () => {
    const primary = makeStore({ ...store, isPrimary: true });
    const body = buildStorePatchBody({ ...storeFormFromStore(primary, 'pt-BR'), name: 'Outro' }, primary, 'pt-BR');
    expect(body).toEqual({ name: 'Outro' });
  });

  test('campos de saque desabilitados continuam no corpo (taxas guardadas, E6-Q16)', () => {
    const state = {
      ...initialStoreFormState(), name: 'X', allowsWithdrawal: false, withdrawalFeeRateText: '2,5', withdrawalFixedFeeText: '0,50',
    };
    expect(buildStoreCreateBody(state, 'pt-BR'))
      .toMatchObject({ allowsWithdrawal: false, withdrawalFeeRate: 0.025, withdrawalFixedFeeCents: 50 });
  });

  test('dinheiro em en e pt-BR; mais de 2 casas e negativo são inválidos', () => {
    const base = { ...initialStoreFormState(), name: 'X' };
    expect(buildStoreCreateBody({ ...base, saleMinFeeText: '0.30' }, 'en').saleMinFeeCents).toBe(30);
    expect(buildStoreCreateBody({ ...base, saleMinFeeText: '1.234,56' }, 'pt-BR').saleMinFeeCents).toBe(123456);
    expect(validateStoreForm({ ...base, saleFixedFeeText: '0,001' }, 'pt-BR')).toEqual({ saleFixedFeeCents: 'storeForm.invalidMoney' });
    expect(validateStoreForm({ ...base, saleMinFeeText: '-1' }, 'en')).toEqual({ saleMinFeeCents: 'storeForm.invalidMoney' });
    expect(validateStoreForm({ ...base, withdrawalFeeRateText: '100' }, 'en')).toEqual({ withdrawalFeeRate: 'storeForm.invalidRate' });
  });
});

describe('traduções usadas pela tela de lojas', () => {
  const flat = (node: unknown, prefix = ''): Set<string> => {
    const keys = new Set<string>();
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') keys.add(key);
      else for (const inner of flat(v, key)) keys.add(inner);
    }
    return keys;
  };
  // Chave plural (tPlural) é um objeto com variantes: basta existir o prefixo.
  const has = (keys: Set<string>, key: string) => keys.has(key) || [...keys].some((k) => k.startsWith(`${key}.`));
  const ptKeys = flat(ptBR);
  const enKeys = flat(en);
  const root = join(__dirname, '..');
  const files = [
    ...readdirSync(join(root, 'components')).filter((f) => /^Store.*\.tsx$/.test(f)).map((f) => join(root, 'components', f)),
    join(root, 'app', 'stores', 'page.tsx'),
    join(root, 'lib', 'storeForm.ts'),
  ];

  test('toda chave literal usada pelos arquivos de loja existe nos dois idiomas', () => {
    const used = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)) used.add(m[1]);
      for (const m of source.matchAll(/'((?:storeForm|stores)\.[A-Za-z0-9_.]+)'/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(10);
    for (const key of used) {
      expect(has(ptKeys, key), `pt-BR ${key}`).toBe(true);
      expect(has(enKeys, key), `en ${key}`).toBe(true);
    }
  });

  test('os escopos stores e storeForm têm as mesmas chaves nos dois idiomas', () => {
    const scope = (s: Set<string>) => [...s].filter((k) => /^(stores|storeForm)\./.test(k)).sort();
    expect(scope(ptKeys)).toEqual(scope(enKeys));
    expect(scope(ptKeys).length).toBeGreaterThan(10);
  });
});
