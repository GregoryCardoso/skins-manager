import { describe, expect, test } from 'vitest';
import { balanceBarScale } from './balanceBarScale';
import { profitTabFromSearch, searchWithProfitTab } from './profitTabs';

const store = (available: number | null, pending: number | null) => ({ availableUsdCents: available, pending: { usdCents: pending } });

describe('balanceBarScale (12.7b)', () => {
  test('devolve o maior total (disponível + pendente) entre as lojas', () => {
    expect(balanceBarScale([store(1000, 500), store(3000, 0), store(200, 2000)])).toBe(3000);
  });
  test('nulos e negativos são ignorados', () => {
    expect(balanceBarScale([store(null, null), store(-500, 700), store(null, -10)])).toBe(700);
  });
  test('tudo zero, nulo ou sem lojas dá 0', () => {
    expect(balanceBarScale([store(0, 0), store(null, null)])).toBe(0);
    expect(balanceBarScale([])).toBe(0);
  });
});

describe('abas do Lucro real na URL (12.7b, P6)', () => {
  test('lê a aba; qualquer outro valor abre os aportes', () => {
    expect(profitTabFromSearch('?tab=withdrawals')).toBe('withdrawals');
    expect(profitTabFromSearch('tab=withdrawals')).toBe('withdrawals');
    expect(profitTabFromSearch('?tab=xyz')).toBe('deposits');
    expect(profitTabFromSearch('')).toBe('deposits');
  });
  test('grava a aba e deixa a URL limpa na aba padrão, mantendo os outros parâmetros', () => {
    expect(searchWithProfitTab('', 'withdrawals')).toBe('?tab=withdrawals');
    expect(searchWithProfitTab('?tab=withdrawals', 'deposits')).toBe('');
    expect(searchWithProfitTab('?a=1&tab=withdrawals', 'deposits')).toBe('?a=1');
  });
});
