import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { errorMessageFor } from '@/i18n/errorMessage';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate } from '@/i18n/translate';
import { CURRENCIES, currencyOptions, moneyInputMode } from './currencies';
import { buildDepositCreateBody, buildDepositPatchBody, depositFormFromDeposit, validateDepositForm } from './depositForm';
import { buildCreateBody, defaultRateFor, fieldVisibility, initialCreateState, applyPurchaseStore, stateFromItem } from './itemForm';
import { ratesRecord } from './fxRates';
import { buildLaunchBody } from './pendingActions';
import { formatCentsInput, parseMoneyToCents } from './numberInput';
import { applySaleStore, buildSellBody, initialSellState, needsFx } from './sellForm';
import { buildStoreBalanceBody, buildCheckPreviewQuery, validateStoreBalanceForm } from './storeBalanceForm';
import { buildStoreCreateBody, buildStorePatchBody, initialStoreFormState, storeFormFromStore, validateStoreForm } from './storeForm';
import { makeItem, makeStore } from './testFixtures';
import { buildWithdrawalCreateBody, buildWithdrawalPatchBody, validateWithdrawalForm, withdrawalFormFromWithdrawal } from './withdrawalForm';
import type { Deposit, Withdrawal } from '@/types/api';

const read = (relative: string) => readFileSync(join(__dirname, '..', relative), 'utf-8');
const tPt = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
const tEn = (key: string, params?: Record<string, string | number>) => translate(en, key, params);

describe('dinheiro digitado nas moedas sem casas decimais (JPY, KRW e CLP)', () => {
  test.each(['JPY', 'KRW', 'CLP'])('%s: só inteiros; "1500" = 150000 centavos; decimais, milhar e vazio são recusados', (currency) => {
    expect(parseMoneyToCents('1500', 'en', currency)).toBe(150000);
    expect(parseMoneyToCents('0', 'pt-BR', currency)).toBe(0);
    for (const bad of ['15.50', '15,50', '1,500', '1.500', '-5', 'abc', '']) expect(parseMoneyToCents(bad, 'en', currency)).toBeNull();
  });

  test('as moedas com 2 casas continuam como antes, com ou sem a moeda informada', () => {
    expect(parseMoneyToCents('1,25', 'pt-BR')).toBe(125);
    expect(parseMoneyToCents('1.25', 'en', 'EUR')).toBe(125);
    expect(parseMoneyToCents('1.234,56', 'pt-BR', 'BRL')).toBe(123456);
    expect(parseMoneyToCents('1.256', 'en', 'USD')).toBeNull();
  });

  test('formatCentsInput: sem casas nas moedas sem casas; 2 casas nas demais', () => {
    expect(formatCentsInput(150000, 'en', 'JPY')).toBe('1500');
    expect(formatCentsInput(150000, 'pt-BR', 'KRW')).toBe('1500');
    expect(formatCentsInput(150000, 'pt-BR', 'EUR')).toBe('1500,00');
    expect(formatCentsInput(125, 'en')).toBe('1.25');
  });

  test('o teclado é numérico só nas moedas sem casas', () => {
    expect(moneyInputMode('JPY')).toBe('numeric');
    expect(moneyInputMode('EUR')).toBe('decimal');
    expect(moneyInputMode(undefined)).toBe('decimal');
  });
});

describe('formulário de lojas nas 17 moedas', () => {
  test('o seletor oferece as 17 moedas, nesta ordem', () => {
    expect(currencyOptions('en').map((option) => option.code)).toEqual([...CURRENCIES]);
    expect(CURRENCIES).toHaveLength(17);
  });

  test('loja em JPY: taxa mínima e fixa são inteiras (erro próprio) e viram múltiplos de 100 centavos', () => {
    const state = { ...initialStoreFormState(), name: 'Loja JPY', currency: 'JPY' as const, saleMinFeeText: '10.5', saleFixedFeeText: '25' };
    expect(validateStoreForm(state, 'en')).toEqual({ saleMinFeeCents: 'storeForm.invalidMoneyWhole' });
    const ok = { ...state, saleMinFeeText: '10', withdrawalFixedFeeText: '300' };
    expect(validateStoreForm(ok, 'en')).toEqual({});
    expect(buildStoreCreateBody(ok, 'en')).toMatchObject({ currency: 'JPY', saleMinFeeCents: 1000, saleFixedFeeCents: 2500, withdrawalFixedFeeCents: 30000 });
  });

  test('loja em EUR: duas casas, como em USD', () => {
    const state = { ...initialStoreFormState(), name: 'Loja EUR', currency: 'EUR' as const, saleMinFeeText: '0,30' };
    expect(validateStoreForm(state, 'pt-BR')).toEqual({});
    expect(buildStoreCreateBody(state, 'pt-BR')).toMatchObject({ currency: 'EUR', saleMinFeeCents: 30 });
    expect(validateStoreForm({ ...state, saleMinFeeText: '0,301' }, 'pt-BR')).toEqual({ saleMinFeeCents: 'storeForm.invalidMoney' });
  });

  test('editar uma loja em KRW mostra as taxas sem casas e o PATCH só leva o que mudou', () => {
    const store = makeStore({ id: 9, name: 'Loja KRW', currency: 'KRW', saleMinFeeCents: 100000, saleFixedFeeCents: 50000 });
    const state = storeFormFromStore(store, 'en');
    expect(state).toMatchObject({ currency: 'KRW', saleMinFeeText: '1000', saleFixedFeeText: '500' });
    expect(buildStorePatchBody(state, store, 'en')).toEqual({});
    expect(buildStorePatchBody({ ...state, saleFixedFeeText: '600' }, store, 'en')).toEqual({ saleFixedFeeCents: 60000 });
  });

  test('o modal usa a lista das 17 moedas, trava a moeda com lançamentos e segue a moeda da loja nos rótulos e no teclado', () => {
    const modal = read('components/StoreFormModal.tsx');
    expect(modal).toMatch(/currencyOptions\(locale\)\.map/);
    expect(modal).toMatch(/currencyLocked = editing && store\.inUse/);
    expect(modal).toMatch(/disabled=\{currencyLocked\}/);
    expect(modal).toMatch(/currencySymbol\(state\.currency, locale\)/);
    expect(modal).not.toMatch(/'US\$' : 'R\$'/);
    expect(modal.match(/moneyInputMode\(state\.currency\)/g)).toHaveLength(3);
  });
});

describe('rótulos e campos de valor seguem a moeda da loja', () => {
  const files = ['StoreBalanceFormModal', 'StoreFormModal'];
  test.each(files)('%s não tem "R$"/"US$" fixos', (name) => {
    expect(read(`components/${name}.tsx`)).not.toMatch(/'US\$'|'R\$'/);
  });

  test('conferência de saldo em JPY: valor inteiro, na unidade da moeda', () => {
    const state = { amountText: '12300', recordedAt: '2026-11-10T10:00', noteText: '' };
    expect(validateStoreBalanceForm(state, 'en', { currency: 'JPY' })).toEqual({});
    expect(validateStoreBalanceForm({ ...state, amountText: '123.5' }, 'en', { currency: 'JPY' })).toEqual({ balanceCents: 'storeBalances.form.invalidMoneyWhole' });
    expect(buildStoreBalanceBody(state, 3, 'en', false, 'JPY').balanceCents).toBe(1230000);
    expect(buildCheckPreviewQuery(state, 3, 'en', 'JPY')).toMatchObject({ balanceCents: 1230000 });
    expect(buildStoreBalanceBody({ ...state, amountText: '123.45' }, 3, 'en', false, 'EUR').balanceCents).toBe(12345);
  });
});

describe('compra e venda em lojas de qualquer moeda', () => {
  const eur = makeStore({ id: 5, name: 'Loja EUR', currency: 'EUR', saleFeeType: 'DEDUCTED', saleFeeRate: 0.03, saleFeesConfigured: true });
  const jpy = makeStore({ id: 6, name: 'Loja JPY', currency: 'JPY', saleFeeType: 'DEDUCTED', saleFeeRate: 0.03, saleFeesConfigured: true });
  const usd = makeStore({ id: 1, name: 'CSFloat', isPrimary: true });
  const stores = [usd, eur, jpy];
  const rates = ratesRecord([{ currency: 'EUR', rate: 0.92 }, { currency: 'JPY', rate: 150.5 }, { currency: 'BRL', rate: null }]);
  const ctx = { stores, usdBrlRate: null, rates, language: 'en' };

  test('a cotação aparece em loja fora de USD (não só BRL) e vem da cotação da moeda da loja', () => {
    expect(fieldVisibility({ ...initialCreateState(ctx), purchaseStoreId: 5 }, stores).fx).toBe(true);
    expect(fieldVisibility({ ...initialCreateState(ctx), purchaseStoreId: 1 }, stores).fx).toBe(false);
    expect(defaultRateFor(ctx, 'EUR')).toBe(0.92);
    expect(defaultRateFor(ctx, 'USD')).toBeNull();
    expect(defaultRateFor({ usdBrlRate: 5.4, rates: undefined }, 'BRL')).toBe(5.4);
    const next = applyPurchaseStore(initialCreateState(ctx), 5, ctx);
    expect(next.fxText).toBe('0.92');
    expect(applyPurchaseStore(next, 6, ctx)).toMatchObject({ fxText: '150.5', priceText: '' });
    expect(applyPurchaseStore(next, 1, ctx).fxText).toBe('');
  });

  test('preço de compra em JPY: inteiro; decimal é recusado; vai em centavos (x100) com a cotação do iene', () => {
    const base = { ...initialCreateState(ctx), freeMode: true, category: 'OUTRO' as const, name: 'Caixa', purchaseStoreId: 6, fxText: '150.5' };
    expect(buildCreateBody({ ...base, priceText: '1500' }, ctx)).toMatchObject({ ok: true, body: { purchasePriceCents: 150000, fxRateAtPurchase: 150.5 } });
    expect(buildCreateBody({ ...base, priceText: '1500.5' }, ctx)).toMatchObject({ ok: false, errors: { purchasePriceCents: 'itemForm.invalidMoneyWhole' } });
  });

  test('editar item comprado em JPY mostra o preço sem casas', () => {
    const item = makeItem({ purchaseStoreId: 6, purchaseCurrency: 'JPY', purchasePriceCents: 150000, fxRateAtPurchase: 150.5 });
    expect(stateFromItem(item, 'en')).toMatchObject({ priceText: '1500', fxText: '150.5' });
  });

  test('venda em loja EUR pede cotação (padrão da moeda) e em JPY só aceita preço inteiro', () => {
    expect(needsFx(eur)).toBe(true);
    expect(needsFx(usd)).toBe(false);
    const initial = initialSellState(ctx, '2026-11-18T12:00');
    const onEur = applySaleStore(initial, 5, ctx);
    expect(onEur.fxText).toBe('0.92');
    const onJpy = applySaleStore({ ...onEur, fxText: '' }, 6, ctx);
    expect(onJpy.fxText).toBe('150.5');
    expect(buildSellBody({ ...onJpy, priceText: '1050' }, ctx, null)).toMatchObject({ ok: true, body: { saleStoreId: 6, salePriceCents: 105000, fxRateAtSale: 150.5 } });
    expect(buildSellBody({ ...onJpy, priceText: '1050.5' }, ctx, null)).toMatchObject({ ok: false, errors: { salePriceCents: 'itemForm.invalidMoneyWhole' } });
    expect(buildSellBody({ ...onJpy, priceText: '1050', netText: '1000.5', netTouched: true }, ctx, null)).toMatchObject({ ok: false, errors: { netReceivedCents: 'itemForm.invalidMoneyWhole' } });
  });

  test('"Lançar compra" em loja EUR aceita a cotação; em JPY o preço é inteiro', () => {
    const state = { storeId: 5, price: '10,00', fxRate: '0,92', acquiredAt: '2026-11-10T10:00', tradeUnlockAt: '', unlockEdited: false };
    expect(buildLaunchBody(state as never, stores, 'pt-BR')).toMatchObject({ ok: true, purchase: { purchasePriceCents: 1000, fxRateAtPurchase: 0.92 } });
    expect(buildLaunchBody({ ...state, storeId: 6, price: '10,5' } as never, stores, 'pt-BR')).toMatchObject({ ok: false, errors: { price: 'imports.launch.priceInvalidWhole' } });
  });

  test('os modais usam a cotação da moeda da loja, e não só o BRL', () => {
    expect(read('components/ItemFormModal.tsx')).toMatch(/defaultRateFor\(ctx, priceCurrency\)/);
    expect(read('components/SellItemModal.tsx')).toMatch(/ratesRecord\(fxRates\)/);
    expect(read('components/OpenContainerModal.tsx')).toMatch(/steamStore\.currency !== 'USD'/);
    expect(read('components/LaunchPurchaseModal.tsx')).toMatch(/store\.currency !== 'USD'/);
    expect(read('lib/itemForm.ts')).not.toMatch(/store?.currency === 'BRL'|next?.currency === 'BRL'|primary?.currency === 'BRL'/);
    expect(read('lib/sellForm.ts')).not.toMatch(/store?.currency === 'BRL'|primary?.currency === 'BRL'/);
  });
});

describe('saques e aportes: moeda da loja e moeda do valor informativo', () => {
  const withdrawal = (overrides: Partial<Withdrawal> = {}): Withdrawal => ({
    id: 1, storeId: 6, storeName: 'Loja JPY', currency: 'JPY', amountStoreCents: 500000, feeCents: 10000, netStoreCents: 490000,
    amountBrlCents: 3000, amountBrlCurrency: 'EUR', withdrawnAt: '2026-11-10T15:30:00.000Z', note: null, legacyWithoutStore: false,
    amountUsdCents: 3000, approxCents: null, approxCurrency: 'USD', estimated: true, createdAt: 'x', updatedAt: 'x', ...overrides,
  });

  test('saque em JPY com "recebido" em EUR: valor e taxa inteiros; recebido com duas casas', () => {
    const state = { storeId: 6, amountText: '5000', feeText: '100', feeTouched: true, receivedText: '30,00', withdrawnAt: '2026-11-10T10:00', note: '' };
    const currencies = { store: 'JPY', received: 'EUR' };
    expect(validateWithdrawalForm(state, 'pt-BR', currencies)).toEqual({});
    expect(buildWithdrawalCreateBody(state, 'pt-BR', currencies)).toMatchObject({ storeId: 6, amountStoreCents: 500000, feeCents: 10000, amountBrlCents: 3000 });
    expect(validateWithdrawalForm({ ...state, amountText: '5000,5' }, 'pt-BR', currencies)).toMatchObject({ amountStoreCents: 'withdrawals.form.invalidMoneyWhole' });
    expect(validateWithdrawalForm({ ...state, receivedText: '30,00' }, 'pt-BR', { store: 'JPY', received: 'KRW' })).toMatchObject({ amountBrlCents: 'withdrawals.form.invalidMoneyWhole' });
  });

  test('editar um saque mostra cada valor na sua moeda e o PATCH só leva o que mudou', () => {
    const original = withdrawal();
    const state = withdrawalFormFromWithdrawal(original, 'en');
    expect(state).toMatchObject({ amountText: '5000', feeText: '100', receivedText: '30.00' });
    expect(buildWithdrawalPatchBody(state, original, 'en', { store: 'JPY', received: 'EUR' })).toEqual({});
    expect(buildWithdrawalPatchBody({ ...state, receivedText: '31.00' }, original, 'en', { store: 'JPY', received: 'EUR' })).toEqual({ amountBrlCents: 3100 });
  });

  test('aporte: o valor pago informativo usa a moeda do registro (não só R$)', () => {
    const deposit: Deposit = {
      id: 1, storeId: 1, storeName: 'CSFloat', currency: 'USD', amountStoreCents: 5000, amountBrlCents: 750000, amountBrlCurrency: 'JPY',
      depositedAt: '2026-11-10T15:30:45.123Z', note: null, legacy: false, amountUsdCents: 5000, approxCents: null, approxCurrency: 'USD',
      estimated: false, createdAt: 'x', updatedAt: 'x',
    };
    const state = depositFormFromDeposit(deposit, 'en');
    expect(state.paidText).toBe('7500');
    expect(validateDepositForm({ ...state, paidText: '7500.5' }, 'en', 'JPY')).toEqual({ amountBrlCents: 'deposits.form.invalidMoneyWhole' });
    expect(validateDepositForm(state, 'en', 'JPY')).toEqual({});
    expect(buildDepositCreateBody({ ...state, storeId: 1 }, 'en', 'JPY')).toMatchObject({ amountBrlCents: 750000 });
    expect(buildDepositPatchBody(state, deposit, 'en', 'JPY')).toEqual({});
  });

  test('as tabelas e a página do lucro mostram o valor informativo na moeda gravada', () => {
    for (const file of ['components/DepositsTable.tsx', 'components/WithdrawalsTable.tsx', 'app/profit/page.tsx']) {
      expect(read(file)).not.toMatch(/AmountBrl[^\n]*'BRL'|amountBrlCents, 'BRL'|\.amountBrlCents, 'BRL'/);
      expect(read(file)).toMatch(/amountBrlCurrency \?\? 'BRL'/);
    }
  });
});

describe('textos novos (en e pt-BR)', () => {
  test('AMOUNT_PRECISION_INVALID traduzido com a moeda', () => {
    const e = new ApiRequestError('AMOUNT_PRECISION_INVALID', 'msg', 400, { field: 'purchasePriceCents', params: { currency: 'JPY', unitCents: 100 } });
    expect(errorMessageFor(e, tEn, 'en')).toBe('JPY has no decimal places. Enter a whole number, like 1500.');
    expect(errorMessageFor(e, tPt, 'pt-BR')).toBe('JPY não tem centavos. Informe um número inteiro, como 1500.');
    const noParams = new ApiRequestError('AMOUNT_PRECISION_INVALID', 'msg', 400, {});
    expect(errorMessageFor(noParams, tEn, 'en')).toBe('This currency has no decimal places. Enter a whole number.');
  });

  test('STORE_CURRENCY_LOCKED continua traduzido; FX_RATE_REQUIRED cita a moeda', () => {
    expect(errorMessageFor(new ApiRequestError('STORE_CURRENCY_LOCKED', 'msg', 409, {}), tPt, 'pt-BR')).toMatch(/moeda não pode mudar/);
    const fx = new ApiRequestError('FX_RATE_REQUIRED', 'msg', 400, { params: { currency: 'EUR' } });
    expect(errorMessageFor(fx, tEn, 'en')).toBe('Enter the exchange rate for US$ 1 in EUR, or save one in Settings.');
  });

  test('as linhas da Steam no modal existem nos dois idiomas, com {currency} e {from}', () => {
    for (const t of [tEn, tPt]) {
      expect(t('currency.modal.steamFollow', { currency: 'EUR' })).toContain('EUR');
      expect(t('currency.modal.steamLocked', { from: 'BRL' })).toContain('BRL');
      expect(t('currency.modal.steamNewStore', { currency: 'EUR' })).toContain('EUR');
      expect(t('currency.modal.steamNewStoreHint', { from: 'BRL' })).toContain('Steam (BRL)');
    }
  });
});
