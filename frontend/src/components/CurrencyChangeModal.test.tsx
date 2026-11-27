// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { renderUi } from '@/test/renderUi';
import type { CurrencyChangePreview } from '@/types/api';

const api = vi.hoisted(() => ({ getCurrencyChangePreview: vi.fn(), getSettings: vi.fn() }));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));

const prefs = vi.hoisted(() => ({ changeDisplayCurrency: vi.fn(), refreshFxRate: vi.fn(), saveFxRate: vi.fn(), displayCurrency: 'USD' }));
vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => prefs }));

import CurrencyChangeModal from './CurrencyChangeModal';

// Campos que o currencyChangeView lê da prévia do backend.
function preview(extra: Record<string, unknown> = {}): CurrencyChangePreview {
  return { currency: 'EUR', fxRateAvailable: true, automaticSource: true, steamStore: null, ...extra } as unknown as CurrencyChangePreview;
}

function renderModal(currency = 'EUR') {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderUi(<CurrencyChangeModal currency={currency} onClose={onClose} />, { client });
  return { onClose };
}

beforeEach(() => {
  for (const fn of [api.getCurrencyChangePreview, api.getSettings, prefs.changeDisplayCurrency, prefs.refreshFxRate, prefs.saveFxRate]) fn.mockReset();
  api.getSettings.mockResolvedValue({ fxManualRateBounds: { EUR: { min: 0.1, max: 10 }, ARS: { min: 5, max: 500000 } } });
  prefs.changeDisplayCurrency.mockResolvedValue({});
  prefs.refreshFxRate.mockResolvedValue({});
  prefs.saveFxRate.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('modal da moeda de conversão', () => {
  test('com cotação gravada: sem campo de cotação; confirmar troca e fecha', async () => {
    api.getCurrencyChangePreview.mockResolvedValue(preview());
    const { onClose } = renderModal();
    expect(screen.getByText(/Show values in/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Exchange rate/)).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: /Use EUR/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(prefs.changeDisplayCurrency).toHaveBeenCalledWith('EUR', 'KEEP');
    expect(prefs.saveFxRate).not.toHaveBeenCalled();
  });

  test('sem cotação e sem fonte automática (MANUAL): aparece o campo opcional com a faixa aceita', async () => {
    api.getCurrencyChangePreview.mockResolvedValue(preview({ fxRateAvailable: false, automaticSource: false }));
    renderModal();
    const field = await screen.findByLabelText(/Exchange rate \(US\$ 1 = ___ EUR\)/);
    expect(field).toBeInTheDocument();
    expect(screen.getByText(/Optional\. Enter it now/)).toBeInTheDocument();
    expect(await screen.findByText('Accepted range: 0.1 to 10')).toBeInTheDocument();
  });

  test('cotação digitada: grava a cotação (PUT) ANTES de trocar a moeda (PATCH)', async () => {
    api.getCurrencyChangePreview.mockResolvedValue(preview({ fxRateAvailable: false, automaticSource: false }));
    const order: string[] = [];
    prefs.saveFxRate.mockImplementation(async () => { order.push('rate'); });
    prefs.changeDisplayCurrency.mockImplementation(async () => { order.push('change'); return {}; });
    const { onClose } = renderModal();
    await userEvent.type(await screen.findByLabelText(/Exchange rate/), '0.92');
    await userEvent.click(screen.getByRole('button', { name: /Use EUR/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(order).toEqual(['rate', 'change']);
    expect(prefs.saveFxRate).toHaveBeenCalledWith('EUR', 0.92);
  });

  test('cotação recusada: nada muda e o erro aparece no campo', async () => {
    api.getCurrencyChangePreview.mockResolvedValue(preview({ fxRateAvailable: false, automaticSource: false }));
    prefs.saveFxRate.mockRejectedValue(new ApiRequestError('FX_RATE_OUT_OF_RANGE', 'x', 400, { params: { currency: 'EUR', min: 0.1, max: 10 } }));
    const { onClose } = renderModal();
    await userEvent.type(await screen.findByLabelText(/Exchange rate/), '500');
    await userEvent.click(screen.getByRole('button', { name: /Use EUR/ }));
    expect(await screen.findByText(/That rate looks wrong/)).toBeInTheDocument();
    expect(prefs.changeDisplayCurrency).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Exchange rate/)).toHaveAttribute('aria-invalid', 'true');
  });

  test('fora da faixa: avisa enquanto digita, sem bloquear o envio', async () => {
    api.getCurrencyChangePreview.mockResolvedValue(preview({ fxRateAvailable: false, automaticSource: false }));
    renderModal();
    await userEvent.type(await screen.findByLabelText(/Exchange rate/), '500');
    expect(await screen.findByText(/outside the usual range/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use EUR/ })).toBeEnabled();
  });

  test('falha da troca: erro dentro do modal e o modal continua aberto', async () => {
    api.getCurrencyChangePreview.mockResolvedValue(preview());
    prefs.changeDisplayCurrency.mockRejectedValue(new ApiRequestError('NETWORK_ERROR', 'x', 0));
    const { onClose } = renderModal();
    await userEvent.click(await screen.findByRole('button', { name: /Use EUR/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('busca automática falha depois da troca: a troca vale e o campo da cotação aparece no modal', async () => {
    api.getCurrencyChangePreview.mockResolvedValue(preview({ fxRateAvailable: false, automaticSource: true }));
    prefs.refreshFxRate.mockRejectedValue(new ApiRequestError('FX_FETCH_FAILED', 'x', 502));
    const { onClose } = renderModal();
    expect(screen.queryByLabelText(/Exchange rate/)).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: /Use EUR/ }));
    expect(await screen.findByText(/Could not fetch the exchange rate for/)).toBeInTheDocument();
    expect(prefs.changeDisplayCurrency).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/Exchange rate/), '0.92');
    await userEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(prefs.saveFxRate).toHaveBeenCalledWith('EUR', 0.92);
    expect(prefs.changeDisplayCurrency).toHaveBeenCalledTimes(1);
  });

  test('o botão de confirmar fica desabilitado enquanto a prévia carrega', () => {
    api.getCurrencyChangePreview.mockReturnValue(new Promise(() => {}));
    renderModal();
    expect(screen.getByRole('button', { name: /Use EUR/ })).toBeDisabled();
  });

  test('cancelar fecha sem gravar nada', async () => {
    api.getCurrencyChangePreview.mockResolvedValue(preview());
    const { onClose } = renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(prefs.changeDisplayCurrency).not.toHaveBeenCalled();
  });
});
