// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { resetStartupStatusForTests } from '@/lib/startupStatus';
import { renderUi } from '@/test/renderUi';
import GlobalNotices from './GlobalNotices';

const prefs = vi.hoisted(() => ({ displayCurrency: 'USD', fxRates: [] as unknown[], requiredFxCurrencies: [] as string[] }));
const failure = vi.hoisted(() => ({ current: null as null | { currency: string; reason: string } }));

vi.mock('@/components/PreferencesProvider', () => ({ usePreferences: () => prefs }));
// O host de cotação é testado à parte; aqui ele só entrega (ou não) uma falha ao montar.
vi.mock('@/components/FxAutoRefreshHost', async () => {
  const React = await import('react');
  return {
    default: ({ onFailure }: { onFailure?: (value: { currency: string; reason: string } | null) => void }) => {
      React.useEffect(() => {
        if (failure.current) onFailure?.(failure.current);
      }, [onFailure]);
      return null;
    },
  };
});
vi.mock('./StartupOfflineBanner', () => ({ default: () => null }));

const entry = (rate: number | null) => ({ currency: 'BRL', rate, source: rate === null ? null : 'AWESOMEAPI', refreshSource: 'AWESOMEAPI', quotedAt: null, updatedAt: '2026-11-21T12:00:00.000Z' });

function renderNotices() {
  return renderUi(<GlobalNotices />, { client: new QueryClient() });
}

beforeEach(() => {
  resetStartupStatusForTests();
  prefs.displayCurrency = 'USD';
  prefs.fxRates = [];
  prefs.requiredFxCurrencies = [];
  failure.current = null;
});
afterEach(cleanup);

describe('GlobalNotices (12.4)', () => {
  test('USD não mostra nada', () => {
    renderNotices();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('moeda de conversão (BRL) sem cotação mostra o Banner informativo com o link para as Configurações', () => {
    prefs.displayCurrency = 'BRL';
    prefs.requiredFxCurrencies = ['BRL'];
    prefs.fxRates = [entry(null)];
    renderNotices();
    expect(screen.getByText('There is no exchange rate for BRL yet, so values with ≈ are not shown.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Settings' }).getAttribute('href')).toMatch(/^\/settings\/?$/);
  });

  test('BRL com cotação não mostra o aviso', () => {
    prefs.displayCurrency = 'BRL';
    prefs.requiredFxCurrencies = ['BRL'];
    prefs.fxRates = [entry(5.2)];
    renderNotices();
    expect(screen.queryByText(/no exchange rate/)).toBeNull();
  });

  test('a falha da atualização automática vira Banner de aviso com o link para as Configurações', () => {
    failure.current = { currency: 'EUR', reason: 'source down' };
    renderNotices();
    expect(screen.getByRole('alert')).toHaveTextContent('source down');
    expect(screen.getByRole('link', { name: 'Go to Settings' }).getAttribute('href')).toMatch(/^\/settings\/?$/);
  });

  test('não duplica: falha da mesma moeda de conversão esconde o aviso "sem cotação"', () => {
    prefs.displayCurrency = 'BRL';
    prefs.requiredFxCurrencies = ['BRL'];
    prefs.fxRates = [entry(null)];
    failure.current = { currency: 'BRL', reason: 'source down' };
    renderNotices();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/no exchange rate/)).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Go to Settings' })).toHaveLength(1);
  });

  test('a região dos avisos tem nome e fica vazia (escondida pelo CSS) sem avisos', () => {
    const { container } = renderNotices();
    const region = container.querySelector('section') as HTMLElement;
    expect(region).toHaveAttribute('aria-label', 'App notices');
    expect(region).toBeEmptyDOMElement();
  });
});
