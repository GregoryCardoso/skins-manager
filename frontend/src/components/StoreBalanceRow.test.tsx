// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeBalance } from '@/test/profitFixtures';
import { renderUi } from '@/test/renderUi';
import StoreBalanceRow from './StoreBalanceRow';

afterEach(cleanup);

function renderRow(props: Partial<React.ComponentProps<typeof StoreBalanceRow>> = {}) {
  const handlers = { onDeposit: vi.fn(), onWithdraw: vi.fn(), onCheck: vi.fn(), onHistory: vi.fn() };
  renderUi(
    <ul>
      <StoreBalanceRow store={makeBalance()} scaleMaxCents={100000} canDeposit canWithdraw {...handlers} {...props} />
    </ul>,
  );
  return handlers;
}

describe('StoreBalanceRow (12.7b)', () => {
  test('os botões de aporte e saque só aparecem nas lojas elegíveis, e o clique entrega a loja', async () => {
    const h = renderRow();
    await userEvent.click(screen.getByRole('button', { name: 'Record deposit' }));
    expect(h.onDeposit).toHaveBeenCalledWith(expect.objectContaining({ storeId: 1 }));
    await userEvent.click(screen.getByRole('button', { name: 'Record withdrawal' }));
    expect(h.onWithdraw).toHaveBeenCalledWith(expect.objectContaining({ storeId: 1 }));
    cleanup();
    renderRow({ canDeposit: false, canWithdraw: false });
    expect(screen.queryByRole('button', { name: 'Record deposit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record withdrawal' })).toBeNull();
  });

  test('Conferir e o histórico (no menu) chamam os tratadores', async () => {
    const h = renderRow();
    await userEvent.click(screen.getByRole('button', { name: 'Check balance' }));
    expect(h.onCheck).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'More actions for CSFloat' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'History' }));
    expect(h.onHistory).toHaveBeenCalledTimes(1);
  });

  test('a barra tem o resumo em texto (role img) e o saldo aparece com a moeda e o "≈"', () => {
    renderRow({ store: makeBalance({ pending: { cents: 2500, count: 1, nextReleaseAt: '2026-12-01T12:00:00.000Z', usdCents: 2500, approxCents: 12500, estimated: false } }) });
    expect(screen.getByRole('img', { name: 'Available $750.00, pending $25.00' })).toBeInTheDocument();
    expect(screen.getByText('$750.00')).toBeInTheDocument();
    expect(screen.getByText(/≈.*R\$.*3,750\.00|≈.*3,750\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$25\.00 pending · releases on/)).toBeInTheDocument();
  });

  test('o selo da moeda tem nome acessível; loja inativa e não sacável ganham selos com texto', () => {
    renderRow({ store: makeBalance({ isActive: false, allowsWithdrawal: false }) });
    expect(screen.getByText('Currency: USD')).toBeInTheDocument();
    expect(screen.getByText('inactive')).toBeInTheDocument();
    expect(screen.getByText('not withdrawable')).toBeInTheDocument();
  });

  test('saldo negativo mostra o aviso e a classe de perda', () => {
    renderRow({ store: makeBalance({ availableCents: -1500, availableUsdCents: -1500, negative: true, warningCode: 'COMPUTED_BALANCE_NEGATIVE' }) });
    expect(screen.getByText(/The calculated balance is negative/)).toBeInTheDocument();
    expect(screen.getByText(/^[−-]\$15\.00$/).closest('span[class*="negative"]')).not.toBeNull();
  });

  test('"Detalhes do cálculo" abre as 5 linhas do cálculo', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: 'Calculation details' }));
    const list = screen.getByLabelText('How the available balance is calculated');
    expect(within(list).getAllByText(/Deposits|Purchases|Withdrawals|Released sales|Adjustments/)).toHaveLength(5);
  });

  test('loja em BRL sem cotação: barra vazia e aviso com link para as configurações', () => {
    renderRow({
      store: makeBalance({
        storeName: 'Steam', currency: 'BRL', availableCents: 10000, availableUsdCents: null, availableApproxCents: null,
        warningCode: 'FX_NOT_CONFIGURED', pending: { cents: 0, count: 0, nextReleaseAt: null, usdCents: null, approxCents: null, estimated: false },
      }),
    });
    expect(screen.getByText('The exchange rate is not set. Enter the rate in Settings.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go to Settings/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Available R\$100\.00/ })).toBeInTheDocument();
  });

  test('"nunca conferido" e "última conferência" em texto discreto', () => {
    renderRow();
    expect(screen.getByText('Balance never checked')).toBeInTheDocument();
    cleanup();
    renderRow({ store: makeBalance({ daysSinceLastCheck: 3 }) });
    expect(screen.getByText('Last checked 3 days ago')).toBeInTheDocument();
  });
});
