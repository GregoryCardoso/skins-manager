import { describe, expect, test } from 'vitest';
import { buildWithdrawalPatchBody, withdrawalFormFromWithdrawal } from './withdrawalForm';
import type { Withdrawal } from '@/types/api';

// D221: troca de loja no PATCH (o frontend só monta o corpo; a regra de moeda é do backend).
const withdrawal = (overrides: Partial<Withdrawal> = {}): Withdrawal => ({
  id: 1, storeId: 1, storeName: 'CSFloat', currency: 'USD', amountStoreCents: 10000, feeCents: 250, amountBrlCents: 52000,
  withdrawnAt: '2026-11-10T15:30:00.000Z', note: 'pix', legacyWithoutStore: false,
  netStoreCents: 9750, amountUsdCents: 9750, approxCents: null, estimated: false,
  createdAt: '2026-11-10T15:30:00.000Z', updatedAt: '2026-11-10T15:30:00.000Z', ...overrides,
});
const original = withdrawal();
const form = (o = {}) => ({ ...withdrawalFormFromWithdrawal(original, 'pt-BR'), ...o });

describe('buildWithdrawalPatchBody com troca de loja (D221)', () => {
  test('troca sem mexer em mais nada: storeId + amountStoreCents + feeCents; nada de recebido, data ou nota', () => {
    expect(buildWithdrawalPatchBody(form({ storeId: 2 }), original, 'pt-BR')).toEqual({ storeId: 2, amountStoreCents: 10000, feeCents: 250 });
  });

  test('troca com valor novo envia o valor novo', () => {
    expect(buildWithdrawalPatchBody(form({ storeId: 2, amountText: '80,00' }), original, 'pt-BR')).toEqual({ storeId: 2, amountStoreCents: 8000, feeCents: 250 });
  });

  test('troca com taxa esvaziada envia feeCents: null; com taxa nova envia o valor novo', () => {
    expect(buildWithdrawalPatchBody(form({ storeId: 2, feeText: '' }), original, 'pt-BR')).toEqual({ storeId: 2, amountStoreCents: 10000, feeCents: null });
    expect(buildWithdrawalPatchBody(form({ storeId: 2, feeText: '1,00' }), original, 'pt-BR')).toEqual({ storeId: 2, amountStoreCents: 10000, feeCents: 100 });
  });

  test('loja igual à gravada: não envia storeId nem amountStoreCents', () => {
    expect(buildWithdrawalPatchBody(form({ storeId: 1 }), original, 'pt-BR')).toEqual({});
  });

  test('loja não escolhida (null) não envia nada de loja nem valor', () => {
    expect(buildWithdrawalPatchBody(form({ storeId: null }), original, 'pt-BR')).toEqual({});
  });

  test('troca com texto do valor inválido: amountStoreCents fica de fora (a validação local barra antes)', () => {
    expect(buildWithdrawalPatchBody(form({ storeId: 2, amountText: 'abc' }), original, 'pt-BR')).toEqual({ storeId: 2, feeCents: 250 });
  });

  test('saque antigo sem loja com taxa vazia: loja, valor e feeCents null vão', () => {
    const old = withdrawal({ storeId: null, storeName: null, currency: null, amountStoreCents: null, feeCents: null, legacyWithoutStore: true });
    const f = { ...withdrawalFormFromWithdrawal(old, 'pt-BR'), storeId: 2, amountText: '10,00' };
    expect(buildWithdrawalPatchBody(f, old, 'pt-BR')).toEqual({ storeId: 2, amountStoreCents: 1000, feeCents: null });
  });

  // D221: "quando a moeda da loja muda, envia amountStoreCents e feeCents (o valor do campo, ou null se vazio)
  // mesmo que o usuário não tenha mexido".
  test('D221: troca de loja com taxa inalterada envia feeCents', () => {
    expect(buildWithdrawalPatchBody(form({ storeId: 2 }), original, 'pt-BR')).toHaveProperty('feeCents', 250);
  });
});
