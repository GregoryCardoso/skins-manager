import { describe, expect, test } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { moneyErrorParams } from '@/lib/currencies';
import { buildLaunchBody } from '@/lib/pendingActions';
import { makeStore } from '@/lib/testFixtures';
import { errorMessageFor } from './errorMessage';
import en from './en.json';
import ptBR from './pt-BR.json';
import { translate, translatePlural } from './translate';

// 11.6, parada C (lojas, configurações, importações e integração): plurais novos, `zero` e mensagens de moeda sem centavos.
const tPt = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
const tEn = (key: string, params?: Record<string, string | number>) => translate(en, key, params);
const plural = (lang: 'pt-BR' | 'en', key: string, count: number, params?: Record<string, string | number>) =>
  translatePlural(lang === 'pt-BR' ? ptBR : en, key, count, lang, params);

const WITH_ZERO = [
  'imports.cutoffChange.upToPurchases', 'imports.cutoffChange.upToSales', 'imports.cutoffChange.purchasesCount', 'imports.cutoffChange.salesCount',
  'imports.cutoffChange.importedKept', 'imports.cutoffChange.openToClose', 'imports.transferCutoff.upToDeposits', 'imports.transferCutoff.upToWithdrawals',
  'imports.bulk.selected', 'imports.page.ignored', 'stores.count', 'storesTable.saleHoldDays', 'catalog.itemsCount',
];
const WITHOUT_ZERO = ['imports.transferCutoff.openToClose', 'imports.won.body', 'imports.bulk.failed', 'imports.page.pendingCount'];

describe('plurais da área C', () => {
  test.each(WITH_ZERO)('%s tem zero, um e outros, e o zero difere do outros nos dois idiomas', (key) => {
    for (const lang of ['pt-BR', 'en'] as const) {
      const zero = plural(lang, key, 0, { value: 'US$ 1' });
      const one = plural(lang, key, 1, { value: 'US$ 1' });
      const other = plural(lang, key, 5, { value: 'US$ 1' });
      expect(zero).not.toContain(`${key}.`);
      expect(one).not.toBe(other);
      if (key !== 'storesTable.saleHoldDays') expect(zero).not.toBe(other);
      expect(other).toContain('5');
    }
  });

  test.each(WITHOUT_ZERO)('%s tem um e outros (sem zero: a tela só mostra com 1 ou mais)', (key) => {
    for (const lang of ['pt-BR', 'en'] as const) {
      expect(plural(lang, key, 1)).not.toBe(plural(lang, key, 3));
    }
  });

  test('nenhum "(s)", "(ies)" nem "trade(s)" nos textos de importação e de data de corte', () => {
    const flat = JSON.stringify([ptBR.imports, en.imports]);
    expect(flat).not.toMatch(/\(s\)|\(ies\)|\(es\)|\(os\)|\(as\)/);
  });

  test('zero natural nas datas de corte', () => {
    expect(plural('pt-BR', 'imports.cutoffChange.upToPurchases', 0)).toBe('Nenhuma compra já vista pode entrar.');
    expect(plural('en', 'imports.cutoffChange.upToSales', 0)).toBe('No sales already seen can come in.');
    expect(plural('pt-BR', 'imports.cutoffChange.importedKept', 0)).toBe('Nenhum lançamento foi importado nesse período.');
    expect(plural('pt-BR', 'imports.transferCutoff.upToDeposits', 1, { value: 'US$ 5,00' })).toBe('Até 1 aporte já visto no extrato (US$ 5,00).');
    expect(plural('en', 'imports.transferCutoff.upToWithdrawals', 3, { value: 'US$ 5.00' })).toBe('Up to 3 withdrawals already seen in the statement (US$ 5.00).');
  });

  test('"Lançamentos seus" junta as duas contagens, cada uma no seu plural', () => {
    const purchases = plural('pt-BR', 'imports.cutoffChange.purchasesCount', 1);
    const sales = plural('pt-BR', 'imports.cutoffChange.salesCount', 0);
    expect(tPt('imports.cutoffChange.manualLaunches', { purchases, sales })).toBe(
      'Lançamentos seus na loja CSFloat nesse período: 1 compra e nenhuma venda. Eles serão ligados quando baterem, sem duplicar.',
    );
    expect(tEn('imports.cutoffChange.manualLaunches', {
      purchases: plural('en', 'imports.cutoffChange.purchasesCount', 2),
      sales: plural('en', 'imports.cutoffChange.salesCount', 1),
    })).toContain('2 purchases and 1 sale.');
  });

  test('ignorados, selecionados e lojas', () => {
    expect(plural('pt-BR', 'imports.page.ignored', 0)).toBe('Nenhum ignorado');
    expect(plural('pt-BR', 'imports.page.ignored', 4)).toBe('4 ignorados');
    expect(plural('en', 'imports.bulk.selected', 0)).toBe('None selected');
    expect(plural('pt-BR', 'imports.bulk.selected', 1)).toBe('1 selecionado');
    expect(plural('pt-BR', 'stores.count', 0)).toBe('Nenhuma loja');
    expect(plural('en', 'stores.count', 0)).toBe('No stores');
  });

  test('importação de backup e atualização do catálogo usam o plural de cada número', () => {
    const items = plural('pt-BR', 'inventory.itemCount', 1);
    const stores = plural('pt-BR', 'stores.count', 3);
    expect(tPt('settings.backup.importDone', { items, stores, backup: 'x.sqlite' })).toBe(
      `Backup importado: ${items} e ${stores}. Cópia dos dados anteriores: x.sqlite.`,
    );
    const total = plural('pt-BR', 'catalog.itemsCount', 1, { count: '1' });
    expect(tPt('catalog.refreshDone', { total, skipped: 2, linked: 0 })).toBe(
      'Catálogo atualizado: 1 item. Seus itens ligados ao catálogo: 0. Registros ignorados: 2.',
    );
    expect(plural('en', 'catalog.itemsCount', 0)).toBe('no items');
  });

  test('"Ganhei": o tempo até vender usa os dias no plural, com 0 dias', () => {
    const days = translatePlural(ptBR, 'common.dayCount', 0, 'pt-BR');
    expect(tPt('imports.won.turnoverHint', { days })).toBe('Com a data da venda, o tempo até vender fica em 0 dias.');
    expect(tEn('imports.won.turnoverHint', { days: translatePlural(en, 'common.dayCount', 0, 'en') })).toBe('With the sale date, the time to sell is 0 days.');
  });
});

describe('dias nos textos dos limites de giro', () => {
  test('a ordem dos limites diz "1 dia" no singular e usa "encalhado"/"stuck"', () => {
    const e = new ApiRequestError('AGING_THRESHOLDS_ORDER', 'm', 400, { params: { fastTurnoverDays: 1, slowItemDays: 1 } });
    expect(errorMessageFor(e, tPt, 'pt-BR')).toBe('O giro rápido (1 dia) deve ser menor que o limite de encalhado (1 dia).');
    expect(errorMessageFor(e, tEn, 'en')).toBe('Fast turnover (1 day) must be lower than the stuck limit (1 day).');
    const many = new ApiRequestError('AGING_THRESHOLDS_ORDER', 'm', 400, { params: { fastTurnoverDays: 30, slowItemDays: 21 } });
    expect(errorMessageFor(many, tPt, 'pt-BR')).toContain('(30 dias)');
  });

  test('os textos dos limites recebem os dias já em plural', () => {
    expect(tPt('settings.aging.defaultValue', { days: translatePlural(ptBR, 'common.dayCount', 1, 'pt-BR') })).toBe('Padrão: 1 dia');
    expect(tPt('settings.aging.middle', { from: 8, to: translatePlural(ptBR, 'common.dayCount', 21, 'pt-BR') })).toBe('Em giro: de 8 até 21 dias.');
    expect(tEn('settings.aging.adjusted', { fast: translatePlural(en, 'common.dayCount', 1, 'en') })).toContain('calculated as 1 day.');
    expect(ptBR.settings.aging.slow).toBe('Encalhado acima de');
    expect(en.settings.aging.slow).toBe('Stuck above');
  });
});

describe('moedas sem centavos nas taxas da loja e no "Lançar compra"', () => {
  test('mensagens da loja usam o exemplo do idioma e o nome da moeda', () => {
    expect(tPt('storeForm.invalidMoney', moneyErrorParams('pt-BR', 'BRL'))).toBe('Informe um valor com até duas casas decimais, como 1,25.');
    expect(tEn('storeForm.invalidMoney', moneyErrorParams('en', 'USD'))).toBe('Enter an amount with up to two decimal places, like 1.25.');
    expect(tPt('storeForm.invalidMoneyWhole', moneyErrorParams('pt-BR', 'JPY'))).toBe('JPY não tem centavos. Informe um número inteiro, como 1500.');
    expect(tEn('storeForm.invalidMoneyWhole', moneyErrorParams('en', 'KRW'))).toBe('KRW has no decimal places. Enter a whole number, like 1500.');
  });

  const stores = [makeStore({ id: 5, currency: 'EUR' }), makeStore({ id: 6, currency: 'JPY' })];
  const base = { fxRate: '', acquiredAt: '2026-11-10T10:00', tradeUnlockAt: '', unlockEdited: false };

  test('"Lançar compra" em loja JPY com decimais usa a mensagem própria; vazio e EUR seguem a geral', () => {
    const jpy = buildLaunchBody({ ...base, storeId: 6, price: '10,5' } as never, stores, 'pt-BR');
    expect(jpy).toMatchObject({ ok: false, errors: { price: 'imports.launch.priceInvalidWhole' } });
    expect(buildLaunchBody({ ...base, storeId: 6, price: '' } as never, stores, 'pt-BR')).toMatchObject({ ok: false, errors: { price: 'imports.launch.priceRequired' } });
    expect(buildLaunchBody({ ...base, storeId: 5, price: 'abc' } as never, stores, 'pt-BR')).toMatchObject({ ok: false, errors: { price: 'imports.launch.priceRequired' } });
    expect(tPt('imports.launch.priceInvalidWhole', moneyErrorParams('pt-BR', 'JPY'))).toBe('JPY não tem centavos. Informe o preço pago como um número inteiro, como 1500.');
    expect(tEn('imports.launch.priceInvalidWhole', moneyErrorParams('en', 'JPY'))).toBe('JPY has no decimal places. Enter the price paid as a whole number, like 1500.');
    expect(tPt('imports.launch.priceRequired', moneyErrorParams('pt-BR', 'EUR'))).toBe('Informe o preço pago, como 1,25.');
  });

  test('cotação inválida da compra mostra o exemplo do idioma', () => {
    expect(tPt('imports.launch.fxInvalid', { example: moneyErrorParams('pt-BR', undefined).example })).toBe('Cotação inválida. Digite um número maior que zero, como 1,25.');
    expect(tEn('imports.launch.fxInvalid', { example: moneyErrorParams('en', undefined).example })).toBe('Invalid rate. Enter a number greater than zero, like 1.25.');
  });
});
