// 9.7 (D313, D314): conferência com o CSFloat no Lucro real e aviso de taxa da conta.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import ptBR from '@/i18n/pt-BR.json';
import en from '@/i18n/en.json';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('o botão fica só na loja da integração com chave salva e "Registrar" abre a conferência da 8.6 preenchida', () => {
  const panel = read('components/StoreBalancesPanel.tsx');
  expect(panel).toMatch(/integration\.hasApiKey && integration\.storeId === store\.storeId/);
  expect(panel).toMatch(/initialAmountCents/);
  const form = read('components/StoreBalanceFormModal.tsx');
  expect(form).toMatch(/initialAmountCents === null \? initial/);
});

test('a conferência é só leitura: nenhuma chamada de escrita no componente', () => {
  const box = read('components/CsfloatBalanceCheck.tsx');
  expect(box).toMatch(/checkCsfloatBalance/);
  expect(box).not.toMatch(/invalidate\(/);
});

test('textos da 9.7 nos dois idiomas', () => {
  for (const lang of [ptBR, en]) {
    for (const key of ['button', 'explain', 'register', 'matches', 'differs', 'inTransit', 'explainHint'] as const) {
      expect(lang.balanceCheck[key]).toBeTruthy();
    }
    for (const reason of ['BEFORE_CUTOFF', 'NOT_IMPORTED', 'NOT_READ', 'IN_TRANSIT', 'IGNORED', 'REMOVED_IN_APP', 'FINE', 'REFUND', 'UNKNOWN_TYPE'] as const) {
      expect(lang.balanceCheck.reasons[reason]).toBeTruthy();
    }
    expect(lang.imports.warnings.ACCOUNT_SALE_FEE_DIFFERS).toBeTruthy();
    expect(lang.imports.warnings.ACCOUNT_WITHDRAWAL_FEE_DIFFERS).toBeTruthy();
  }
  expect(ptBR.balanceCheck.checkedAt).toMatch(/Nada foi salvo/);
});
