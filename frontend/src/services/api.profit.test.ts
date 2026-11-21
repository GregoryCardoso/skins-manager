import { afterEach, describe, expect, test, vi } from 'vitest';
import { formatPercent } from '@/lib/format';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate } from '@/i18n/translate';
import { getProfitSummary } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('resumo do lucro real (8.4)', () => {
  test('getProfitSummary: GET /profit/summary', async () => {
    const payload = { realProfitBrlCents: 117575, warnings: [] };
    const fn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: payload }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fn);
    await expect(getProfitSummary()).resolves.toEqual(payload);
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/profit/summary');
    expect(init.method).toBe('GET');
  });

  test('formatPercent: 77,5% em pt-BR e 77.5% em en', () => {
    expect(formatPercent(62037 / 80000, 'pt-BR')).toBe('77,5%');
    expect(formatPercent(62037 / 80000, 'en')).toBe('77.5%');
    expect(formatPercent(0.3, 'pt-BR')).toBe('30%');
  });

  test('textos do pendente e do liberado existem nos dois idiomas com os mesmos marcadores', () => {
    for (const key of ['profit.pendingIncluded', 'profit.releasedIncluded', 'profit.estimatedNote', 'profit.summary.realProfit', 'profit.summary.warningStore']) {
      expect(translate(ptBR, key), key).not.toBe(key);
      expect(translate(en, key), key).not.toBe(key);
      const holders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
      expect(holders(translate(en, key)), key).toEqual(holders(translate(ptBR, key)));
    }
    expect(translate(ptBR, 'profit.pendingIncluded', { amount: 'R$ 461,73', date: '25/11/2026' }))
      .toBe('inclui ≈ R$ 461,73 pendente (libera a partir de 25/11/2026)');
  });

  test('o subtítulo não promete mais o resumo para depois', () => {
    expect(translate(ptBR, 'profit.subtitle')).not.toMatch(/próxima atualização/);
    expect(translate(en, 'profit.subtitle')).not.toMatch(/next update/);
  });
});
