// @vitest-environment jsdom
import '@/test/setupDom';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { initialStoreFormState, type StoreFormState } from '@/lib/storeForm';
import { renderUi } from '@/test/renderUi';
import type { StoreFeePreview } from '@/types/api';

const api = vi.hoisted(() => ({ previewStoreFee: vi.fn() }));
vi.mock('@/services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/services/api')>()), ...api }));

import FeeExample from './FeeExample';

const form = (extra: Partial<StoreFormState> = {}): StoreFormState => ({ ...initialStoreFormState(), saleFeeType: 'DEDUCTED', ...extra });
const preview = (feeCents: number): StoreFeePreview => ({ currency: 'USD', saleFeeType: 'DEDUCTED', priceCents: 1000, feeCents, netCents: 1000 - feeCents });

interface Deferred { resolve: (value: StoreFeePreview) => void; reject: (reason: unknown) => void; rate: number; signal?: AbortSignal }
let pending: Deferred[];

function renderExample(state: StoreFormState) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderUi(<FeeExample state={state} />, { client });
  return { ...view, rerenderWith: (next: StoreFormState) => view.rerender(<FeeExample state={next} />) };
}

beforeEach(() => {
  pending = [];
  api.previewStoreFee.mockReset();
  api.previewStoreFee.mockImplementation(
    (query: { rate: number }, signal?: AbortSignal) => new Promise<StoreFeePreview>((resolve, reject) => pending.push({ resolve, reject, rate: query.rate, signal })),
  );
});
afterEach(cleanup);

describe('FeeExample: debounce e respostas fora de ordem', () => {
  test('mudanças rápidas (dentro dos 300 ms) viram um único pedido novo, com o último valor (o primeiro, ao abrir, sai na hora)', async () => {
    const view = renderExample(form({ saleFeeRateText: '2' }));
    await waitFor(() => expect(api.previewStoreFee).toHaveBeenCalledTimes(1));
    view.rerenderWith(form({ saleFeeRateText: '3' }));
    view.rerenderWith(form({ saleFeeRateText: '4' }));
    view.rerenderWith(form({ saleFeeRateText: '5' }));
    expect(api.previewStoreFee).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.previewStoreFee).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(api.previewStoreFee).toHaveBeenCalledTimes(2);
    expect(pending[1].rate).toBeCloseTo(0.05);
  });

  test('a resposta antiga chegando DEPOIS da nova não sobrescreve a frase', async () => {
    const view = renderExample(form({ saleFeeRateText: '2' }));
    await waitFor(() => expect(pending).toHaveLength(1)); // pedido A (2%)
    view.rerenderWith(form({ saleFeeRateText: '3' }));
    await waitFor(() => expect(pending).toHaveLength(2)); // pedido B (3%)
    pending[1].resolve(preview(30));
    expect(await screen.findByText('On a sale of $10.00, the fee is $0.30 and you receive $9.70.')).toBeInTheDocument();
    pending[0].resolve(preview(20)); // chega atrasada
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText('On a sale of $10.00, the fee is $0.30 and you receive $9.70.')).toBeInTheDocument();
    expect(screen.queryByText(/the fee is \$0\.20/)).toBeNull();
  });

  test('o pedido antigo é cancelado (signal abortado) quando o novo começa', async () => {
    const view = renderExample(form({ saleFeeRateText: '2' }));
    await waitFor(() => expect(pending).toHaveLength(1));
    view.rerenderWith(form({ saleFeeRateText: '3' }));
    await waitFor(() => expect(pending).toHaveLength(2));
    await waitFor(() => expect(pending[0].signal?.aborted).toBe(true));
    expect(pending[1].signal?.aborted).toBe(false);
  });

  test('erro do pedido antigo, depois do novo ter dado certo, não aparece', async () => {
    const view = renderExample(form({ saleFeeRateText: '2' }));
    await waitFor(() => expect(pending).toHaveLength(1));
    view.rerenderWith(form({ saleFeeRateText: '3' }));
    await waitFor(() => expect(pending).toHaveLength(2));
    pending[1].resolve(preview(30));
    await screen.findByText(/the fee is \$0\.30/);
    pending[0].reject(new Error('boom'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(/Could not calculate the example/)).toBeNull();
    expect(screen.getByText(/the fee is \$0\.30/)).toBeInTheDocument();
  });

  test('apagar o percentual sai do exemplo sem novo pedido e sem frase antiga', async () => {
    const view = renderExample(form({ saleFeeRateText: '2' }));
    await waitFor(() => expect(pending).toHaveLength(1));
    pending[0].resolve(preview(20));
    await screen.findByText(/the fee is \$0\.20/);
    view.rerenderWith(form({ saleFeeRateText: '', saleFeeType: '' }));
    expect(await screen.findByText(/No sale fee set/)).toBeInTheDocument();
    expect(screen.queryByText(/the fee is/)).toBeNull();
    expect(api.previewStoreFee).toHaveBeenCalledTimes(1);
  });
});
