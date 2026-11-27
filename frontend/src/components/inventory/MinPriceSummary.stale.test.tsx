// @vitest-environment jsdom
import '@/test/setupDom';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderUi } from '@/test/renderUi';
import type { MinPrice } from '@/types/api';
import MinPriceSummary from './MinPriceSummary';

const prefs = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../PreferencesProvider', () => ({
  usePreferences: () => {
    if (!prefs.value) throw new Error('fora do provider');
    return prefs.value;
  },
}));

afterEach(cleanup);

const entry = { storeId: 1, storeName: 'Steam', minPriceCents: 1000, currency: 'USD', approx: { cents: 5500, currency: 'BRL' }, warning: null, warningCode: null } as unknown as MinPrice;
const stores = [{ id: 1, isPrimary: true }] as never;

describe('aviso de cotação velha no preço mínimo (12.12, M2)', () => {
  test('cotação automática com mais de 3 dias: mostra o aviso ao lado do "≈"', () => {
    prefs.value = { displayCurrency: 'BRL', fxRates: [{ currency: 'BRL', source: 'AWESOMEAPI', quotedAt: '2020-01-01T00:00:00.000Z', rate: 5.5 }] };
    renderUi(<MinPriceSummary minPrices={[entry]} stores={stores} />);
    expect(screen.getByText(/≈/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rate|quote/i })).toBeInTheDocument();
  });

  test('cotação digitada à mão ou sem preferências: sem aviso', () => {
    prefs.value = { displayCurrency: 'BRL', fxRates: [{ currency: 'BRL', source: 'MANUAL', quotedAt: '2020-01-01T00:00:00.000Z', rate: 5.5 }] };
    renderUi(<MinPriceSummary minPrices={[entry]} stores={stores} />);
    expect(screen.queryByRole('button', { name: /rate|quote/i })).toBeNull();
    cleanup();
    prefs.value = null;
    renderUi(<MinPriceSummary minPrices={[entry]} stores={stores} />);
    expect(screen.queryByRole('button', { name: /rate|quote/i })).toBeNull();
  });
});
