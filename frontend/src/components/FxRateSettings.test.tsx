// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { renderUi } from '@/test/renderUi';
import type { FxRateEntry } from '@/types/api';

const NOW = Date.now();
const entry = (currency: string, rate: number | null, ageDays = 0, source: FxRateEntry['source'] = 'AWESOMEAPI'): FxRateEntry => ({
  currency, rate, source, refreshSource: 'AWESOMEAPI', quotedAt: new Date(NOW - ageDays * 86_400_000).toISOString(), updatedAt: new Date(NOW).toISOString(),
} as FxRateEntry);

const prefs = vi.hoisted(() => ({
  displayCurrency: 'BRL',
  fxRates: [] as unknown[],
  requiredFxCurrencies: ['BRL'] as string[],
  saveFxRate: vi.fn(),
  saveFxRefreshSource: vi.fn(),
  refreshFxRate: vi.fn(),
}));
vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => prefs }));

const api = vi.hoisted(() => ({ getSettings: vi.fn() }));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));

import FxRateSettings from './FxRateSettings';

function renderFx() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderUi(<FxRateSettings />, { client, withToast: true });
}

beforeEach(() => {
  prefs.displayCurrency = 'BRL';
  prefs.requiredFxCurrencies = ['BRL'];
  prefs.fxRates = [entry('BRL', 5.2)];
  for (const fn of [prefs.saveFxRate, prefs.saveFxRefreshSource, prefs.refreshFxRate]) fn.mockReset();
  prefs.saveFxRate.mockResolvedValue(undefined);
  prefs.saveFxRefreshSource.mockResolvedValue(undefined);
  prefs.refreshFxRate.mockResolvedValue({ quote: { source: 'AWESOMEAPI', rate: 5.31 }, currency: 'BRL' });
  api.getSettings.mockResolvedValue({ fxManualRateBounds: { BRL: { min: 0.5, max: 100 }, EUR: { min: 0.1, max: 10 } } });
});
afterEach(cleanup);

describe('Cotações', () => {
  test('uma linha por moeda necessária, com o valor, o selo da moeda de conversão e a faixa aceita', async () => {
    renderFx();
    const row = screen.getByTestId('fx-row-BRL');
    expect(within(row).getByText('Conversion currency')).toBeInTheDocument();
    expect(within(row).getByText(/US\$ 1 = /)).toBeInTheDocument();
    expect(await within(row).findByText('Accepted range: 0.5 to 100')).toBeInTheDocument();
  });

  test('"Atualizar cotação" é o botão principal e mostra a cotação nova num aviso', async () => {
    renderFx();
    const row = screen.getByTestId('fx-row-BRL');
    await userEvent.click(within(row).getByRole('button', { name: 'Update rate' }));
    expect(prefs.refreshFxRate).toHaveBeenCalledWith('BRL');
    expect(await screen.findByText(/Rate updated from/)).toBeInTheDocument();
  });

  test('fora da faixa: avisa enquanto digita e mesmo assim deixa enviar (o servidor decide)', async () => {
    renderFx();
    const row = screen.getByTestId('fx-row-BRL');
    const input = within(row).getByLabelText('Manual rate');
    await userEvent.clear(input);
    await userEvent.type(input, '500');
    expect(await within(row).findByText(/outside the usual range/)).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Save rate' }));
    await waitFor(() => expect(prefs.saveFxRate).toHaveBeenCalledWith('BRL', 500));
  });

  test('dentro da faixa não avisa; o servidor recusando mostra o erro no campo', async () => {
    prefs.saveFxRate.mockRejectedValue(new ApiRequestError('FX_RATE_OUT_OF_RANGE', 'x', 400, { params: { currency: 'BRL', min: 0.5, max: 100 } }));
    renderFx();
    const row = screen.getByTestId('fx-row-BRL');
    const input = within(row).getByLabelText('Manual rate');
    await userEvent.clear(input);
    await userEvent.type(input, '5.5');
    expect(within(row).queryByText(/outside the usual range/)).toBeNull();
    await userEvent.click(within(row).getByRole('button', { name: 'Save rate' }));
    expect(await within(row).findByText(/That rate looks wrong/)).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  test('"1,250" ambíguo oferece "usar 1,25" e "usar 1250" no campo da cotação', async () => {
    renderFx();
    const row = screen.getByTestId('fx-row-BRL');
    const input = within(row).getByLabelText('Manual rate');
    await userEvent.clear(input);
    await userEvent.type(input, '1,250');
    await userEvent.tab();
    expect(await within(row).findByRole('button', { name: /Use 1\.25/ })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /Use 1250/ })).toBeInTheDocument();
  });

  test('cotação antiga: selo com os dias e a dica de atualizar', () => {
    prefs.fxRates = [entry('BRL', 5.2, 9)];
    renderFx();
    expect(screen.getByTestId('fx-stale-BRL')).toBeInTheDocument();
    expect(within(screen.getByTestId('fx-row-BRL')).getAllByText('9 days').length).toBeGreaterThanOrEqual(1);
  });

  test('digitada à mão: dica de que não atualiza sozinha ao abrir o app', () => {
    prefs.fxRates = [entry('BRL', 5.2, 0, 'MANUAL')];
    renderFx();
    expect(screen.getByTestId('fx-auto-refresh-hint-BRL')).toBeInTheDocument();
  });

  test('só o BRL tem escolha de fonte (comercial ou PTAX)', async () => {
    prefs.requiredFxCurrencies = ['BRL', 'EUR'];
    prefs.fxRates = [entry('BRL', 5.2), entry('EUR', 0.9)];
    renderFx();
    expect(within(screen.getByTestId('fx-row-BRL')).getByRole('combobox')).toBeInTheDocument();
    expect(within(screen.getByTestId('fx-row-EUR')).queryByRole('combobox')).toBeNull();
    await userEvent.selectOptions(within(screen.getByTestId('fx-row-BRL')).getByRole('combobox'), 'PTAX');
    expect(prefs.saveFxRefreshSource).toHaveBeenCalledWith('PTAX');
  });

  test('sem moedas necessárias: explica que tudo está em dólar', () => {
    prefs.requiredFxCurrencies = [];
    prefs.fxRates = [];
    renderFx();
    expect(screen.getByTestId('fx-none-needed')).toBeInTheDocument();
  });

  test('falha ao atualizar: Banner de erro na própria linha', async () => {
    prefs.refreshFxRate.mockRejectedValue(new ApiRequestError('NETWORK_ERROR', 'x', 0));
    renderFx();
    const row = screen.getByTestId('fx-row-BRL');
    await userEvent.click(within(row).getByRole('button', { name: 'Update rate' }));
    expect(await within(row).findByRole('alert')).toBeInTheDocument();
  });
});
