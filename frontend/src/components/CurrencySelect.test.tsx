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

describe('CurrencySelect (lista simples, igual à do idioma; pedido do usuário na 12.11)', () => {
  test('é uma lista nativa sem campo de busca: 42 moedas, USD, BRL e EUR soltos no topo e as outras por região', () => {
    renderSelect();
    const select = screen.getByRole('combobox', { name: 'Conversion currency' }) as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.value).toBe('BRL');
    expect(select.options).toHaveLength(42);
    expect([...select.options].slice(0, 3).map((o) => o.value)).toEqual(['USD', 'BRL', 'EUR']);
    expect(new Set([...select.options].map((o) => o.value)).size).toBe(42);
    const groups = [...select.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toEqual(['Americas', 'Europe', 'Asia', 'Other']);
    expect(select.querySelector('optgroup option[value="USD"]')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  test('em japonês, os nomes vêm no idioma (o iene aparece com o nome traduzido)', () => {
    renderSelect('ja');
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const jpy = [...select.options].find((o) => o.value === 'JPY');
    expect(jpy?.textContent).toMatch(/円/);
  });

  test('escolher outra moeda abre o modal de confirmação e NÃO grava; a lista continua na moeda gravada', async () => {
    renderSelect();
    const select = screen.getByRole('combobox', { name: 'Conversion currency' }) as HTMLSelectElement;
    await userEvent.selectOptions(select, 'EUR');
    expect(await screen.findByRole('dialog', { name: /Show values in/ })).toBeInTheDocument();
    expect(prefs.changeDisplayCurrency).not.toHaveBeenCalled();
    expect(select.value).toBe('BRL');
  });

  test('escolher a moeda que já vale não abre nada', async () => {
    renderSelect();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Conversion currency' }), 'BRL');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
