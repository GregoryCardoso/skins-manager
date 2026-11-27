import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import ru from '@/i18n/ru.json';
import { translate, translatePlural } from '@/i18n/translate';
import type { Store } from '@/types/api';
import { saleFeeSentence, saleHoldSentence, storeActionReasons, withdrawalSentence } from './storeSummary';

const store = (extra: Partial<Store> = {}): Store => ({
  id: 1, name: 'CSFloat', currency: 'USD', isActive: true, isPrimary: false, sellsHere: true, saleFeeType: 'DEDUCTED', saleFeeRate: 0.02,
  saleFeeRounding: 'CEIL', saleMinFeeCents: null, saleFixedFeeCents: 0, allowsWithdrawal: false, withdrawalFeeRate: null,
  withdrawalFixedFeeCents: 0, saleHoldDays: 0, createdAt: '', updatedAt: '', saleFeesConfigured: true, inUse: false, ...extra,
});

const translators = (dict: object, locale: string) => ({
  t: (key: string, params?: Record<string, string | number>) => translate(dict, key, params),
  tPlural: (key: string, count: number, params?: Record<string, string | number>) => translatePlural(dict, key, count, locale, params),
  locale,
});

describe('saleFeeSentence', () => {
  test('DEDUCTED: percentual, mínima e fixa numa frase', () => {
    const text = saleFeeSentence(store({ saleMinFeeCents: 3, saleFixedFeeCents: 10 }), translators(en, 'en'));
    expect(text).toBe('2% deducted from the price · minimum $0.03 · fixed $0.10');
  });

  test('ADDED em pt-BR, sem mínima nem fixa', () => {
    const text = saleFeeSentence(store({ saleFeeType: 'ADDED', saleFeeRate: 0.025, saleFeeRounding: 'FLOOR' }), translators(ptBR, 'pt-BR'));
    expect(text).toBe('2,5% somados ao preço');
  });

  test('taxa não configurada devolve null (nunca assume 0)', () => {
    expect(saleFeeSentence(store({ saleFeeType: null, saleFeeRate: null }), translators(en, 'en'))).toBeNull();
    expect(saleFeeSentence(store({ saleFeeType: 'DEDUCTED', saleFeeRate: null }), translators(en, 'en'))).toBeNull();
  });

  test('moeda sem casas decimais (JPY): valores inteiros', () => {
    const text = saleFeeSentence(store({ currency: 'JPY', saleMinFeeCents: 10000, saleFixedFeeCents: 5000 }), translators(en, 'en'));
    expect(text).toContain('minimum ¥100');
    expect(text).toContain('fixed ¥50');
  });
});

describe('withdrawalSentence e saleHoldSentence', () => {
  test('sem saque', () => {
    expect(withdrawalSentence(store(), translators(en, 'en'))).toBe('No');
  });
  test('com saque: percentual e fixa; percentual desconhecido avisa', () => {
    const tr = translators(en, 'en');
    expect(withdrawalSentence(store({ allowsWithdrawal: true, withdrawalFeeRate: 0.01, withdrawalFixedFeeCents: 25 }), tr)).toBe('Yes, 1% · fixed $0.25');
    expect(withdrawalSentence(store({ allowsWithdrawal: true }), tr)).toBe('Yes, fee not set');
  });
  test('retenção: imediata ou N dias, com o plural do idioma (ru e pt-BR)', () => {
    expect(saleHoldSentence(store({ saleHoldDays: 0 }), translators(en, 'en'))).toBe('Immediate');
    expect(saleHoldSentence(store({ saleHoldDays: 1 }), translators(en, 'en'))).toBe('1 day');
    expect(saleHoldSentence(store({ saleHoldDays: 7 }), translators(ptBR, 'pt-BR'))).toBe('7 dias');
    expect(saleHoldSentence(store({ saleHoldDays: 2 }), translators(ru, 'ru'))).toBe('2 дня');
    expect(saleHoldSentence(store({ saleHoldDays: 5 }), translators(ru, 'ru'))).toBe('5 дней');
  });
});

describe('storeActionReasons', () => {
  test('principal ativa: não pode desativar nem excluir, e já é a principal', () => {
    expect(storeActionReasons(store({ isPrimary: true }))).toEqual({
      toggleActive: 'storesTable.reasons.primaryNeeded',
      makePrimary: 'storesTable.reasons.alreadyPrimary',
      toggleSteam: null,
      delete: 'storesTable.reasons.primaryNeeded',
    });
  });
  test('inativa: precisa ativar antes de ser principal; em uso: só desativa', () => {
    const reasons = storeActionReasons(store({ isActive: false, inUse: true }));
    expect(reasons.makePrimary).toBe('storesTable.reasons.activateFirst');
    expect(reasons.delete).toBe('storesTable.reasons.inUse');
    expect(reasons.toggleActive).toBeNull();
  });
  test('loja livre: tudo disponível', () => {
    expect(Object.values(storeActionReasons(store()))).toEqual([null, null, null, null]);
  });
});
