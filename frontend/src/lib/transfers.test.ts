// 9.6 (D306, D311, E9-Q20): taxa do aporte no formulário, aportes/saques no resumo da importação e textos.
import { describe, expect, test } from 'vitest';
import ptBR from '@/i18n/pt-BR.json';
import en from '@/i18n/en.json';
import type { Deposit, ImportEntryView } from '@/types/api';
import { buildDepositCreateBody, buildDepositPatchBody, validateDepositForm } from './depositForm';
import { candidateLink, COUNT_LINES, entryLink, entryLinkLabelKey, isNothingNew, summaryLines } from './importSummary';

const state = { storeId: 2, amountText: '19,76', paidText: '', feeText: '0,20', depositedAt: '2026-11-10T12:30', note: '' };

describe('taxa do aporte no formulário (D311)', () => {
  test('vai no corpo em centavos; vazia é omitida; negativa é recusada', () => {
    expect(buildDepositCreateBody(state, 'pt-BR')).toMatchObject({ amountStoreCents: 1976, feeCents: 20 });
    expect(buildDepositCreateBody({ ...state, feeText: '' }, 'pt-BR')).not.toHaveProperty('feeCents');
    expect(validateDepositForm({ ...state, feeText: '-1' }, 'pt-BR')).toEqual({ feeCents: 'deposits.form.invalidFee' });
  });
  test('edição: só manda a taxa quando muda; esvaziar manda null', () => {
    const original = { storeId: 2, amountStoreCents: 1976, feeCents: 20, amountBrlCents: null, depositedAt: '2026-11-10T15:30:00.000Z', note: null, legacy: false } as unknown as Deposit;
    expect(buildDepositPatchBody({ ...state, feeText: '0,20', depositedAt: '' }, original, 'pt-BR')).not.toHaveProperty('feeCents');
    expect(buildDepositPatchBody({ ...state, feeText: '', depositedAt: '' }, original, 'pt-BR')).toMatchObject({ feeCents: null });
  });
});

describe('aportes e saques no resumo da importação', () => {
  test('contagens novas, na ordem, e contam como novidade', () => {
    expect(COUNT_LINES).toEqual(expect.arrayContaining(['depositsCreated', 'withdrawalsCreated', 'transfersAwaitingCutoff', 'finesNotImported']));
    const counts = {
      purchasesCreated: 0, salesCreated: 0, matched: 0, known: 0, beforeCutoff: 0, notTransferred: 0, review: 0, reverted: 0, failed: 0,
      unknownState: 0, deferredSales: 0, withoutPurchase: 0, depositsCreated: 1, withdrawalsCreated: 1, transfersAwaitingCutoff: 0,
    };
    expect(summaryLines(counts).map((l) => l.key)).toEqual(['depositsCreated', 'withdrawalsCreated']);
    expect(isNothingNew(counts)).toBe(false);
  });
  test('link e candidatos de aporte/saque vão para o lucro real', () => {
    const entry = { entityType: 'DEPOSIT', entityId: 3, display: { txKind: 'DEPOSIT' } } as unknown as ImportEntryView;
    expect(entryLink(entry)).toBe('/profit');
    expect(entryLinkLabelKey(entry)).toBe('imports.seeInProfit');
    expect(candidateLink(entry, 9)).toBe('/profit');
    expect(candidateLink({ display: { txKind: null } } as unknown as ImportEntryView, 9)).toBe('/?item=9');
  });
});

test('textos da 9.6 nos dois idiomas', () => {
  for (const lang of [ptBR, en]) {
    for (const key of ['depositsCreated', 'withdrawalsCreated', 'transfersAwaitingCutoff', 'finesNotImported'] as const) {
      expect((lang.imports.counts as Record<string, unknown>)[key]).toBeTruthy();
    }
    for (const key of ['title', 'question', 'baseDepositHint', 'blockTitle', 'blockTitleNotSet', 'define', 'change', 'manualWarning'] as const) {
      expect(lang.imports.transferCutoff[key]).toBeTruthy();
    }
    expect(lang.imports.txKind.DEPOSIT).toBeTruthy();
    expect(lang.deposits.feeOptional).toBeTruthy();
  }
  expect(ptBR.imports.transferCutoff.question).toMatch(/Já lancei à mão os aportes e saques até qual data/);
});
