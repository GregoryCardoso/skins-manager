import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError } from '@/services/api';
import {
  CONNECTION_RETRY_DELAY_MS,
  checkConnection,
  getConnectionState,
  isConnectionError,
  markDown,
  markUp,
  reportConnectionError,
  resetConnectionStatusForTests,
  touchChecked,
} from './connectionStatus';

beforeEach(() => resetConnectionStatusForTests());
afterEach(() => vi.useRealTimers());

describe('isConnectionError (12.4)', () => {
  test('só rede, tempo esgotado e resposta inválida contam; cancelado não', () => {
    for (const code of ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE']) expect(isConnectionError(new ApiRequestError(code, 'x', 0))).toBe(true);
    for (const code of ['ABORTED', 'UNKNOWN', 'ITEM_NOT_FOUND', 'IMPORT_SOURCE_UNREACHABLE']) expect(isConnectionError(new ApiRequestError(code, 'x', 0))).toBe(false);
    expect(isConnectionError(new Error('x'))).toBe(false);
    expect(isConnectionError(null)).toBe(false);
  });
});

describe('estado da conexão', () => {
  test('começa UP; um erro de conexão só dispara a checagem (CHECKING), nunca vai direto para DOWN', () => {
    expect(getConnectionState()).toEqual({ phase: 'UP', lastCheckedAt: null });
    reportConnectionError();
    expect(getConnectionState().phase).toBe('CHECKING');
    reportConnectionError();
    expect(getConnectionState().phase).toBe('CHECKING');
  });

  test('DOWN → UP com markUp; com o app fora do ar, novos erros não mudam nada e touchChecked só atualiza a hora', () => {
    markDown(1000);
    expect(getConnectionState()).toEqual({ phase: 'DOWN', lastCheckedAt: 1000 });
    reportConnectionError();
    expect(getConnectionState().phase).toBe('DOWN');
    touchChecked(2000);
    expect(getConnectionState()).toEqual({ phase: 'DOWN', lastCheckedAt: 2000 });
    markUp(3000);
    expect(getConnectionState()).toEqual({ phase: 'UP', lastCheckedAt: 3000 });
  });
});

describe('checkConnection: duas falhas com intervalo antes de dar o app como fora do ar', () => {
  test('falha, espera 1,5 s e falha de novo: false (só depois do intervalo)', async () => {
    vi.useFakeTimers();
    const ping = vi.fn().mockRejectedValue(new Error('down'));
    let result: boolean | null = null;
    void checkConnection(ping).then((value) => { result = value; });
    await vi.advanceTimersByTimeAsync(0);
    expect(ping).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(CONNECTION_RETRY_DELAY_MS - 1);
    expect(ping).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(ping).toHaveBeenCalledTimes(2);
    expect(result).toBe(false);
  });

  test('uma falha e depois sucesso: true (o falso alarme com o backend subindo não vira tela)', async () => {
    vi.useFakeTimers();
    const ping = vi.fn().mockRejectedValueOnce(new Error('starting')).mockResolvedValue({});
    const promise = checkConnection(ping);
    await vi.advanceTimersByTimeAsync(CONNECTION_RETRY_DELAY_MS);
    await expect(promise).resolves.toBe(true);
    expect(ping).toHaveBeenCalledTimes(2);
  });

  test('sucesso de primeira não espera nada; uma tentativa só (verificação automática) não repete', async () => {
    const ok = vi.fn().mockResolvedValue({});
    await expect(checkConnection(ok)).resolves.toBe(true);
    expect(ok).toHaveBeenCalledTimes(1);
    const bad = vi.fn().mockRejectedValue(new Error('x'));
    await expect(checkConnection(bad, { attempts: 1 })).resolves.toBe(false);
    expect(bad).toHaveBeenCalledTimes(1);
  });
});
