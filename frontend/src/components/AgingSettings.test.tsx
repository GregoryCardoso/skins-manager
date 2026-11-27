// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { renderUi } from '@/test/renderUi';
import type { Settings } from '@/types/api';

const api = vi.hoisted(() => ({ updatePreferences: vi.fn() }));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));

import AgingSettings, { scaleLimits } from './AgingSettings';

const settings = (extra: Partial<Settings> = {}): Settings => ({
  fastTurnoverDays: 7, slowItemDays: 21, fastTurnoverDaysCustom: null, slowItemDaysCustom: null, fastTurnoverDaysDefault: 7,
  slowItemDaysDefault: 21, agingThresholdsAdjusted: false, ...extra,
} as Settings);

function renderAging(extra: Partial<Settings> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderUi(<AgingSettings settings={settings(extra)} />, { client, withToast: true });
}

beforeEach(() => {
  api.updatePreferences.mockReset();
  api.updatePreferences.mockResolvedValue({});
});
afterEach(cleanup);

describe('scaleLimits (só geometria)', () => {
  const saved = { fastTurnoverDays: 7, slowItemDays: 21 };
  test('números digitados válidos valem; inválidos voltam aos salvos', () => {
    expect(scaleLimits({ fastText: '3', slowText: '30' }, saved)).toEqual({ limits: { fastTurnoverDays: 3, slowItemDays: 30 }, typedValid: true });
    for (const [fast, slow] of [['0', '30'], ['30', '30'], ['31', '30'], ['3', '366'], ['', '30'], ['a', '30']]) {
      expect(scaleLimits({ fastText: fast, slowText: slow }, saved)).toEqual({ limits: saved, typedValid: false });
    }
    expect(scaleLimits({ fastText: '1', slowText: '365' }, saved).typedValid).toBe(true);
  });
});

describe('AgingSettings', () => {
  test('a régua das três faixas segue o que se digita', async () => {
    renderAging();
    const scale = screen.getByTestId('aging-scale');
    expect(scale).toHaveTextContent('7 d');
    expect(scale).toHaveTextContent('21 d');
    const fast = screen.getByLabelText('Fast turnover up to');
    await userEvent.clear(fast);
    await userEvent.type(fast, '3');
    expect(scale).toHaveTextContent('3 d');
    expect(scale).not.toHaveTextContent('7 d');
    expect(screen.getByText('Moving: from 4 up to 21 days.')).toBeInTheDocument();
  });

  test('valores inválidos: a régua mostra os salvos e a dica da regra', async () => {
    renderAging();
    const fast = screen.getByLabelText('Fast turnover up to');
    await userEvent.clear(fast);
    await userEvent.type(fast, '40');
    const scale = screen.getByTestId('aging-scale');
    expect(scale).toHaveTextContent('7 d');
    expect(screen.getByText(/1 ≤ fast < stuck ≤ 365/)).toBeInTheDocument();
  });

  test('salvar envia só o que mudou e mostra o aviso de sucesso', async () => {
    renderAging();
    const slow = screen.getByLabelText('Stuck above');
    await userEvent.clear(slow);
    await userEvent.type(slow, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }));
    await waitFor(() => expect(api.updatePreferences).toHaveBeenCalledWith({ slowItemDays: 30 }));
    expect(await screen.findByText('Limits saved.')).toBeInTheDocument();
  });

  test('sem mudanças não chama a API', async () => {
    renderAging();
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(api.updatePreferences).not.toHaveBeenCalled();
    expect(await screen.findByText('Nothing to save.')).toBeInTheDocument();
  });

  test('AGING_THRESHOLDS_ORDER marca os dois campos', async () => {
    api.updatePreferences.mockRejectedValue(new ApiRequestError('AGING_THRESHOLDS_ORDER', 'x', 400));
    renderAging();
    const fast = screen.getByLabelText('Fast turnover up to');
    await userEvent.clear(fast);
    await userEvent.type(fast, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }));
    await waitFor(() => expect(screen.getByLabelText('Fast turnover up to')).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByLabelText('Stuck above')).toHaveAttribute('aria-invalid', 'true');
  });

  test('"Restaurar padrão" só habilita com valor salvo e envia null', async () => {
    renderAging({ fastTurnoverDaysCustom: 5, fastTurnoverDays: 5 });
    const buttons = screen.getAllByRole('button', { name: 'Restore default' });
    expect(buttons[0]).toBeEnabled();
    expect(buttons[1]).toBeDisabled();
    await userEvent.click(buttons[0]);
    await waitFor(() => expect(api.updatePreferences).toHaveBeenCalledWith({ fastTurnoverDays: null }));
  });

  test('limites ajustados pelo servidor aparecem num aviso', () => {
    renderAging({ agingThresholdsAdjusted: true });
    expect(screen.getByText(/do not match the current default/)).toBeInTheDocument();
  });
});
