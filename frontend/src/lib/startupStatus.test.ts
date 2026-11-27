import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  offlineTasks,
  registerStartupRetry,
  reportStartup,
  resetStartupStatusForTests,
  retryStartupTasks,
} from './startupStatus';

beforeEach(() => resetStartupStatusForTests());

describe('retentativa do início sem internet (12.4)', () => {
  test('refaz só as tarefas que estão sem conexão', async () => {
    const fx = vi.fn().mockResolvedValue(undefined);
    const csfloat = vi.fn().mockResolvedValue(undefined);
    registerStartupRetry('fx', fx);
    registerStartupRetry('csfloat', csfloat);
    reportStartup('fx', 'OFFLINE');
    reportStartup('csfloat', 'OK');
    await retryStartupTasks();
    expect(fx).toHaveBeenCalledTimes(1);
    expect(csfloat).not.toHaveBeenCalled();
  });

  test('sem tarefa offline não chama nada, e uma tarefa sem função registrada é ignorada', async () => {
    const fx = vi.fn().mockResolvedValue(undefined);
    registerStartupRetry('fx', fx);
    await retryStartupTasks();
    expect(fx).not.toHaveBeenCalled();
    reportStartup('csfloat', 'OFFLINE');
    await expect(retryStartupTasks()).resolves.toBeUndefined();
  });

  test('uma função que falha não impede as outras nem rejeita', async () => {
    const bad = vi.fn().mockRejectedValue(new Error('x'));
    const good = vi.fn().mockResolvedValue(undefined);
    registerStartupRetry('fx', bad);
    registerStartupRetry('csfloat', good);
    reportStartup('fx', 'OFFLINE');
    reportStartup('csfloat', 'OFFLINE');
    await expect(retryStartupTasks()).resolves.toBeUndefined();
    expect(good).toHaveBeenCalledTimes(1);
  });

  test('o cancelamento do registro tira a função', async () => {
    const fx = vi.fn().mockResolvedValue(undefined);
    const unregister = registerStartupRetry('fx', fx);
    unregister();
    reportStartup('fx', 'OFFLINE');
    await retryStartupTasks();
    expect(fx).not.toHaveBeenCalled();
    expect(offlineTasks({ fx: 'OFFLINE' })).toEqual(['fx']);
  });
});
