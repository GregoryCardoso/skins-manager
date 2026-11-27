// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PreferencesProvider, usePreferences } from './PreferencesProvider';

const mocks = vi.hoisted(() => ({ getSettings: vi.fn(), updatePreferences: vi.fn() }));
vi.mock('@/services/api', () => ({
  getSettings: mocks.getSettings,
  updatePreferences: mocks.updatePreferences,
  changeDisplayCurrency: vi.fn(),
  refreshFxRate: vi.fn(),
  updateFxRate: vi.fn(),
}));

let result: boolean | null = null;

function Probe() {
  const { inventoryDensity, setInventoryDensity, saveError } = usePreferences();
  return (
    <div>
      <span data-testid="density">{inventoryDensity}</span>
      <span data-testid="error">{saveError === null ? 'none' : 'error'}</span>
      <button type="button" onClick={() => { void setInventoryDensity('COMFORTABLE').then((ok) => { result = ok; }); }}>
        comfortable
      </button>
    </div>
  );
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>
    </QueryClientProvider>,
  );
}

const settings = (density: 'COMPACT' | 'COMFORTABLE') => ({
  theme: 'LIGHT', language: 'en', inventoryView: 'GROUPED', inventoryDensity: density, displayCurrency: 'USD', fxRates: [], requiredFxCurrencies: [],
});

beforeEach(() => {
  result = null;
  mocks.getSettings.mockReset();
  mocks.updatePreferences.mockReset();
});
afterEach(cleanup);

describe('PreferencesProvider: densidade do inventário (v027)', () => {
  test('o padrão é COMPACT e vem do banco', async () => {
    mocks.getSettings.mockResolvedValue(settings('COMFORTABLE'));
    renderProbe();
    expect(screen.getByTestId('density')).toHaveTextContent('COMPACT');
    await waitFor(() => expect(screen.getByTestId('density')).toHaveTextContent('COMFORTABLE'));
  });

  test('a troca aplica na hora, grava com PATCH e devolve true', async () => {
    mocks.getSettings.mockResolvedValue(settings('COMPACT'));
    let release: () => void = () => {};
    mocks.updatePreferences.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    renderProbe();
    await waitFor(() => expect(mocks.getSettings).toHaveBeenCalled());
    await act(async () => { screen.getByRole('button', { name: 'comfortable' }).click(); });
    // otimista: já mudou antes de o servidor responder
    expect(screen.getByTestId('density')).toHaveTextContent('COMFORTABLE');
    expect(mocks.updatePreferences).toHaveBeenCalledWith({ inventoryDensity: 'COMFORTABLE' });
    mocks.getSettings.mockResolvedValue(settings('COMFORTABLE'));
    await act(async () => { release(); });
    await waitFor(() => expect(result).toBe(true));
    expect(screen.getByTestId('density')).toHaveTextContent('COMFORTABLE');
  });

  test('se o PATCH falhar volta ao valor anterior, devolve false e registra o erro', async () => {
    mocks.getSettings.mockResolvedValue(settings('COMPACT'));
    mocks.updatePreferences.mockRejectedValue(new Error('falhou'));
    renderProbe();
    await waitFor(() => expect(mocks.getSettings).toHaveBeenCalled());
    await act(async () => { screen.getByRole('button', { name: 'comfortable' }).click(); });
    await waitFor(() => expect(result).toBe(false));
    expect(screen.getByTestId('density')).toHaveTextContent('COMPACT');
    expect(screen.getByTestId('error')).toHaveTextContent('error');
  });
});
