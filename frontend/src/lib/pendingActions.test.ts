// 9.5.1b (D327 a D331): formulário de "Lançar compra", ações em lote e textos.
import { describe, expect, test } from 'vitest';
import ptBR from '@/i18n/pt-BR.json';
import en from '@/i18n/en.json';
import type { ImportEntryView, Store } from '@/types/api';
import { entryActions } from './importSummary';
import { buildLaunchBody, commonBulkActions, initialLaunchState, setLaunchAcquiredAt } from './pendingActions';
import { localInputToIso } from './dateInput';

const store = (id: number, name: string, currency: 'USD' | 'BRL', isActive = true) => ({ id, name, currency, isActive }) as unknown as Store;
const stores = [store(1, 'CSFloat', 'USD'), store(2, 'Steam', 'BRL'), store(3, 'CSMoney', 'USD')];
const entry = (id: number, allowedActions: ImportEntryView['allowedActions'], extra: Partial<ImportEntryView> = {}) =>
  ({ id, outcome: 'FAILED', reasonCode: 'PURCHASE_NOT_FOUND', resolution: null, allowedActions, ...extra }) as unknown as ImportEntryView;

describe('formulário de "Lançar compra"', () => {
  test('loja inicial fora da integração; o trade lock acompanha a data (+7 dias) até ser editado', () => {
    const initial = initialLaunchState(stores, 1);
    expect(initial.storeId).toBe(2);
    const dated = setLaunchAcquiredAt(initial, '2026-10-01T12:00');
    expect(dated.tradeUnlockAt).toBe('2026-10-08T12:00');
    const edited = setLaunchAcquiredAt({ ...dated, tradeUnlockAt: '2026-10-02T00:00', unlockEdited: true }, '2026-10-05T12:00');
    expect(edited.tradeUnlockAt).toBe('2026-10-02T00:00');
  });

  test('monta o corpo só com o que o usuário informa; erros por campo', () => {
    const state = { storeId: 3, price: '12,50', fxRate: '', acquiredAt: '2026-10-01T12:00', tradeUnlockAt: '', unlockEdited: true };
    expect(buildLaunchBody(state, stores, 'pt-BR')).toEqual({
      ok: true, purchase: { purchaseStoreId: 3, purchasePriceCents: 1250, acquiredAt: localInputToIso('2026-10-01T12:00'), tradeUnlockAt: null },
    });
    expect(buildLaunchBody({ ...state, storeId: 2, fxRate: '5,40' }, stores, 'pt-BR')).toMatchObject({ ok: true, purchase: { fxRateAtPurchase: 5.4 } });
    expect(buildLaunchBody({ ...state, storeId: null, price: '', acquiredAt: '' }, stores, 'pt-BR')).toEqual({
      ok: false, errors: { store: 'imports.launch.storeRequired', price: 'imports.launch.priceRequired', acquiredAt: 'imports.launch.dateRequired' },
    });
  });
});

describe('ações', () => {
  test('o frontend usa as ações do backend (sem o reservado SPLIT_FROM_ITEM)', () => {
    expect(entryActions(entry(1, ['CREATE_PURCHASE', 'MARK_WON', 'IGNORE', 'SPLIT_FROM_ITEM']))).toEqual(['CREATE_PURCHASE', 'MARK_WON', 'IGNORE']);
    expect(entryActions(entry(1, ['REOPEN'], { resolution: 'IGNORED' }))).toEqual(['REOPEN']);
  });
  test('lote: só as ações que valem para todas as selecionadas', () => {
    const a = entry(1, ['CREATE_PURCHASE', 'MARK_WON', 'IGNORE']);
    const b = entry(2, ['IGNORE']);
    expect(commonBulkActions([a])).toEqual(['MARK_WON', 'IGNORE']);
    expect(commonBulkActions([a, b])).toEqual(['IGNORE']);
    expect(commonBulkActions([entry(3, ['REOPEN'])])).toEqual(['REOPEN']);
    expect(commonBulkActions([])).toEqual([]);
  });
});

test('textos da 9.5.1b nos dois idiomas', () => {
  for (const lang of [ptBR, en]) {
    for (const key of ['CREATE_PURCHASE', 'MARK_WON', 'REOPEN'] as const) expect(lang.imports.actions[key]).toBeTruthy();
    for (const key of ['afterSale', 'unlockAfterSale', 'warnBeforeCutoff', 'noCredit', 'purchaseOnly', 'unitInStock'] as const) {
      expect(lang.imports.launch[key]).toBeTruthy();
    }
    expect(lang.imports.groups.IGNORED).toBeTruthy();
    expect(lang.imports.actions.conflict.UNIT_IN_STOCK).toBeTruthy();
  }
  expect(ptBR.imports.actions.MARK_WON).toBe('Foi drop (ganhei)');
});
