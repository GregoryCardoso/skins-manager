// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderUi } from '@/test/renderUi';

const prefs = vi.hoisted(() => ({ displayCurrency: 'BRL', changeDisplayCurrency: vi.fn(), refreshFxRate: vi.fn(), saveFxRate: vi.fn() }));
vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => prefs }));

const api = vi.hoisted(() => ({ getCurrencyChangePreview: vi.fn(), getSettings: vi.fn() }));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));

import CurrencySelect from './CurrencySelect';

function renderSelect(language: 'en' | 'pt-BR' | 'ja' = 'en') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderUi(<CurrencySelect />, { client, language });
}

beforeEach(() => {
  prefs.displayCurrency = 'BRL';
  api.getCurrencyChangePreview.mockResolvedValue({ currency: 'EUR', fxRateAvailable: true, steamStore: null });
  api.getSettings.mockResolvedValue({ fxManualRateBounds: {} });
});
afterEach(cleanup);

describe('CurrencySelect (Combobox de moedas)', () => {
  test('mostra a moeda gravada e abre a lista de 42 moedas por região, com USD, BRL e EUR no topo', async () => {
    renderSelect();
    const input = screen.getByRole('combobox', { name: 'Conversion currency' });
    expect((input as HTMLInputElement).value).toContain('BRL');
    await userEvent.click(input);
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(42);
    expect(options[0]).toHaveTextContent('USD');
    expect(options[1]).toHaveTextContent('BRL');
    expect(options[2]).toHaveTextContent('EUR');
  });

  test('a busca acha pelo nome no idioma e pelo código: "real" acha BRL', async () => {
    renderSelect();
    await userEvent.click(screen.getByRole('combobox', { name: 'Conversion currency' }));
    await userEvent.keyboard('{Control>}a{/Control}');
    await userEvent.keyboard('real');
    const options = await screen.findAllByRole('option');
    expect(options.some((option) => option.textContent?.includes('BRL'))).toBe(true);
    expect(options.length).toBeLessThan(42);
  });

  test('busca em japonês: "円" acha o iene (JPY)', async () => {
    renderSelect('ja');
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.keyboard('{Control>}a{/Control}');
    await userEvent.keyboard('円');
    const options = await screen.findAllByRole('option');
    expect(options.some((option) => option.textContent?.includes('JPY'))).toBe(true);
  });

  test('escolher outra moeda com Enter abre o modal de confirmação e NÃO grava', async () => {
    renderSelect();
    await userEvent.click(screen.getByRole('combobox', { name: 'Conversion currency' }));
    await userEvent.keyboard('{Control>}a{/Control}');
    await userEvent.keyboard('EUR');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(await screen.findByRole('dialog', { name: /Show values in/ })).toBeInTheDocument();
    expect(prefs.changeDisplayCurrency).not.toHaveBeenCalled();
  });

  test('escolher a moeda que já vale não abre nada', async () => {
    renderSelect();
    await userEvent.click(screen.getByRole('combobox', { name: 'Conversion currency' }));
    await userEvent.click(await screen.findByRole('option', { name: /BRL/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
