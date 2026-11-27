// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getConnectionState, reportConnectionError, resetConnectionStatusForTests } from '@/lib/connectionStatus';
import { renderUi } from '@/test/renderUi';
import PageHeader from '@/components/ui/PageHeader';
import ConnectionGate from './ConnectionGate';

const mocks = vi.hoisted(() => ({ getHealth: vi.fn(), reloadFxRate: vi.fn() }));

vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => ({ reloadFxRate: mocks.reloadFxRate }) }));
vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { ...actual, getHealth: mocks.getHealth };
});

function renderGate(client = new QueryClient()) {
  const view = renderUi(
    <ConnectionGate>
      <p>Page body</p>
    </ConnectionGate>,
    { client, withToast: true },
  );
  return { ...view, client };
}

const flush = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetConnectionStatusForTests();
  mocks.getHealth.mockReset();
  mocks.reloadFxRate.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ConnectionGate (12.4)', () => {
  test('duas falhas do /api/health (com 1,5 s entre elas) mostram a tela "não está respondendo"; o conteúdo continua montado, escondido', async () => {
    mocks.getHealth.mockRejectedValue(new Error('down'));
    renderGate();
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => reportConnectionError());
    await flush(0);
    expect(mocks.getHealth).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    await flush(1500);
    expect(mocks.getHealth).toHaveBeenCalledTimes(2);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The app is not responding');
    expect(screen.getByRole('heading', { level: 1, name: 'The app is not responding' })).toHaveFocus();
    expect(getConnectionState().phase).toBe('DOWN');
    expect(screen.getByText('Page body')).toBeInTheDocument();
    expect(screen.getByText('Page body')).not.toBeVisible();
    expect(document.title).toBe('The app is not responding · Skins Manager');
  });

  test('uma falha só (backend ainda subindo) não mostra a tela', async () => {
    mocks.getHealth.mockRejectedValueOnce(new Error('starting')).mockResolvedValue({});
    renderGate();
    act(() => reportConnectionError());
    await flush(1500);
    expect(mocks.getHealth).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Page body')).toBeInTheDocument();
    expect(getConnectionState().phase).toBe('UP');
  });

  test('"Check again" com sucesso: a tela some, tudo é invalidado, a cotação é relida e aparece o Toast', async () => {
    mocks.getHealth.mockRejectedValue(new Error('down'));
    const { client } = renderGate();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    act(() => reportConnectionError());
    await flush(1500);
    await screen.findByRole('alert');

    mocks.getHealth.mockResolvedValue({});
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await flush(0);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Page body')).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalled();
    expect(mocks.reloadFxRate).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Connection restored')).toBeInTheDocument();
  });

  test('fora do ar, confere sozinho a cada 10 s e, ao voltar, recupera sem clique', async () => {
    mocks.getHealth.mockRejectedValue(new Error('down'));
    renderGate();
    act(() => reportConnectionError());
    await flush(1500);
    await screen.findByRole('alert');
    const calls = mocks.getHealth.mock.calls.length;
    mocks.getHealth.mockResolvedValue({});
    await flush(10000);
    expect(mocks.getHealth.mock.calls.length).toBe(calls + 1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.reloadFxRate).toHaveBeenCalled();
  });
  test('ao voltar, a aba volta ao título da página que ficou montada atrás da tela', async () => {
    mocks.getHealth.mockRejectedValue(new Error('down'));
    renderUi(
      <ConnectionGate>
        <PageHeader title="Sales" />
      </ConnectionGate>,
      { client: new QueryClient(), withToast: true },
    );
    expect(document.title).toBe('Sales · Skins Manager');
    act(() => reportConnectionError());
    await flush(1500);
    await screen.findByRole('alert');
    expect(document.title).toBe('The app is not responding · Skins Manager');
    mocks.getHealth.mockResolvedValue({});
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await flush(0);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.title).toBe('Sales · Skins Manager');
  });

  test('mostra a hora da última verificação e o texto de verificando durante a checagem', async () => {
    mocks.getHealth.mockRejectedValue(new Error('down'));
    renderGate();
    act(() => reportConnectionError());
    await flush(1500);
    expect(await screen.findByText(/Last check:/)).toBeInTheDocument();
    expect(within(screen.getByRole('alert')).getAllByRole('listitem')).toHaveLength(3);
  });
});
