import { describe, expect, test } from 'vitest';
import en from './en.json';
import ptBR from './pt-BR.json';
import { translate } from './translate';

// 11.6, parada D (transversais): frases com {source} sem parênteses aninhados e sem jargão na interface.
const tPt = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
const tEn = (key: string, params?: Record<string, string | number>) => translate(en, key, params);

const SOURCE_KEYS = [
  'errorDetails.FX_FETCH_FAILED', 'errorDetails.FX_RATE_LIMITED', 'errorDetails.FX_INVALID_RESPONSE',
  'errorDetails.FX_REFRESH_IN_PROGRESS', 'errorDetails.FX_SOURCE_UNAVAILABLE', 'settings.fx.refreshed',
];

function collect(node: unknown, prefix: string, out: Array<[string, string]>) {
  if (typeof node === 'string') out.push([prefix, node]);
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) collect(v, prefix ? `${prefix}.${k}` : k, out);
}

describe('frases com {source}', () => {
  test.each(SOURCE_KEYS)('%s usa {source} sem parênteses por fora, nos dois idiomas', (key) => {
    for (const t of [tPt, tEn]) {
      const text = t(key, { source: 'PTAX (X)', rate: '5,00' });
      expect(text).toContain('PTAX (X)');
      expect(text).not.toContain('(PTAX (X))');
      expect(text).not.toContain('((');
    }
  });

  test('os nomes das fontes continuam com parênteses próprios (D8)', () => {
    expect(en.fx.sourceName.PTAX).toBe('PTAX (Central Bank of Brazil)');
    expect(ptBR.fx.sourceName.AWESOMEAPI).toBe('Comercial (AwesomeAPI)');
  });
});

describe('sem jargão na interface', () => {
  const FORBIDDEN = [/backend/i, /porta 3001/i, /port 3001/i, /\bResource\b/, /\brecurso\b/i, /pendurado/i, /\bhanging\b/i, /\bSlot\b/, /Display currency/i, /moeda de exibição/i, /\(s\)/, /Agarrado/, /Stagnant/];
  test.each([['en', en], ['pt-BR', ptBR]] as const)('%s não tem termos proibidos', (_lang, dict) => {
    const all: Array<[string, string]> = [];
    collect(dict, '', all);
    const hits = all.filter(([, text]) => FORBIDDEN.some((re) => re.test(text.replace(/\{\w+\}/g, '')))).map(([key]) => key);
    expect(hits).toEqual([]);
  });

  test('conexão com o app, sem servidor', () => {
    expect(tPt('status.server')).toBe('Conexão com o app');
    expect(tEn('status.offline')).toBe('Not responding');
    expect(tPt('desktopUpdate.hide')).toBe('Continuar usando o app');
  });
});
