// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { registerStartupRetry, reportStartup, resetStartupStatusForTests } from '@/lib/startupStatus';
import { renderUi } from '@/test/renderUi';
import StartupOfflineBanner from './StartupOfflineBanner';

const mocks = vi.hoisted(() => ({
  currency: 'BRL',
  fxRates: [{ currency: 'BRL', rate: 5.2, source: 'AWESOMEAPI', refreshSource: 'AWESOMEAPI', quotedAt: '2026-11-20T12:00:00.000Z', updatedAt: '2026-11-21T12:00:00.000Z' }] as unknown[],
  lastImportAt: '2026-11-25T08:30:00.000Z' as string | null,
}));

vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => ({ displayCurrency: mocks.currency }) }));
vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ displayCurrency: mocks.currency, fxRates: mocks.fxRates, requiredFxCurrencies: [mocks.currency] })),
    getCsfloatIntegration: vi.fn(async () => ({ lastImportAt: mocks.lastImportAt, openEntriesCount: 0, importInProgress: false })),
  };
});

function renderBanner() {
  return renderUi(<StartupOfflineBanner />, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
}

beforeEach(() => {
  resetStartupStatusForTests();
  mocks.currency = 'BRL';
  mocks.lastImportAt = '2026-11-25T08:30:00.000Z';
});
afterEach(cleanup);

describe('StartupOfflineBanner (12.4)', () => {
  test('sem tarefa offline, não mostra nada', () => {
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  test('lista o que não foi atualizado, com a última cotação e a última importação; não é um modal', async () => {
    renderBanner();
    act(() => {
      reportStartup('fx', 'OFFLINE');
      reportStartup('csfloat', 'OFFLINE');
    });
    expect(screen.getByText('No internet connection')).toBeInTheDocument();
    expect(screen.getByText(/The exchange rates\./)).toBeInTheDocument();
    expect(screen.getByText(/The CSFloat import/)).toBeInTheDocument();
    expect(await screen.findByText(/Last exchange rate:/)).toBeInTheDocument();
    expect(await screen.findByText(/Last CSFloat import:/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  test('a dica manda usar "Try again" e não cita mais os botões das Configurações', () => {
    renderBanner();
    act(() => reportStartup('fx', 'OFFLINE'));
    expect(screen.getByText(/use "Try again"/)).toBeInTheDocument();
    expect(screen.queryByText(/Settings/)).toBeNull();
  });

  test('com a moeda de conversão em USD não há linha da cotação; sem importação, "No CSFloat import yet."', async () => {
    mocks.currency = 'USD';
    mocks.lastImportAt = null;
    renderBanner();
    act(() => {
      reportStartup('fx', 'OFFLINE');
      reportStartup('csfloat', 'OFFLINE');
    });
    expect(await screen.findByText('No CSFloat import yet.')).toBeInTheDocument();
    expect(screen.queryByText(/Last exchange rate:/)).toBeNull();
  });

  test('"Try again" chama só as tarefas registradas que estão sem conexão', async () => {
    const fx = vi.fn().mockResolvedValue(undefined);
    const csfloat = vi.fn().mockResolvedValue(undefined);
    registerStartupRetry('fx', fx);
    registerStartupRetry('csfloat', csfloat);
    renderBanner();
    act(() => {
      reportStartup('fx', 'OFFLINE');
      reportStartup('csfloat', 'OK');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fx).toHaveBeenCalledTimes(1));
    expect(csfloat).not.toHaveBeenCalled();
  });

  test('o evento "online" da janela refaz uma vez', async () => {
    const fx = vi.fn().mockResolvedValue(undefined);
    registerStartupRetry('fx', fx);
    renderBanner();
    act(() => reportStartup('fx', 'OFFLINE'));
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(fx).toHaveBeenCalledTimes(1));
  });

  test('"Dismiss" esconde; vale para o mesmo conjunto de tarefas, e outra tarefa offline reabre', async () => {
    renderBanner();
    act(() => reportStartup('fx', 'OFFLINE'));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('No internet connection')).toBeNull();
    act(() => reportStartup('csfloat', 'OFFLINE'));
    expect(screen.getByText('No internet connection')).toBeInTheDocument();
  });

  test('some sozinho quando as tarefas voltam a dar OK', () => {
    renderBanner();
    act(() => {
      reportStartup('fx', 'OFFLINE');
      reportStartup('csfloat', 'OFFLINE');
    });
    expect(screen.getByText('No internet connection')).toBeInTheDocument();
    act(() => {
      reportStartup('fx', 'OK');
      reportStartup('csfloat', 'OK');
    });
    expect(screen.queryByText('No internet connection')).toBeNull();
  });
});
