import { describe, expect, test } from 'vitest';
import { translate } from '@/i18n/translate';
import { errorMessageFor } from '@/i18n/errorMessage';
import { ApiRequestError } from '@/services/api';
import ptBR from '@/i18n/pt-BR.json';
import en from '@/i18n/en.json';
import { describeFxRate, fxDateText, fxSourceName, fxSourceShort } from './fxDisplay';

const tPt = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
const tEn = (key: string, params?: Record<string, string | number>) => translate(en, key, params);
const norm = (s: string) => s.replace(/[  ]/g, ' ');

// 20/11/2026 12:00 em Brasília (UTC-3) = 15:00Z; o teste confere só o formato, sem depender do fuso da máquina.
const QUOTED = '2026-11-20T15:00:00.000Z';
const UPDATED = '2026-11-20T13:15:00.000Z';

describe('describeFxRate (fonte e data/hora sempre juntas)', () => {
  test('comercial: "R$ valor · Comercial · data/hora"', () => {
    const text = norm(describeFxRate({ rate: 5.1254, source: 'AWESOMEAPI', quotedAt: QUOTED, updatedAt: UPDATED }, 'pt-BR', tPt));
    expect(text).toMatch(/^R\$ 5,1254 · Comercial · \d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}$/);
    expect(text).toContain('20/11/2026');
  });

  test('PTAX: "PTAX de data/hora"', () => {
    const text = norm(describeFxRate({ rate: 5.3012, source: 'PTAX', quotedAt: '2026-11-19T16:04:28.123Z', updatedAt: UPDATED }, 'pt-BR', tPt));
    expect(text).toMatch(/^R\$ 5,3012 · PTAX de 19\/11\/2026,? \d{2}:\d{2}$/);
  });

  test('manual: "Manual · editada em data/hora" usa a gravação, não a data da fonte', () => {
    const text = norm(describeFxRate({ rate: 5.5, source: 'MANUAL', quotedAt: null, updatedAt: UPDATED }, 'pt-BR', tPt));
    expect(text).toMatch(/^R\$ 5,50 · Manual · editada em 20\/11\/2026,? \d{2}:\d{2}$/);
  });

  test('em inglês', () => {
    const text = norm(describeFxRate({ rate: 5.1254, source: 'AWESOMEAPI', quotedAt: QUOTED, updatedAt: null }, 'en', tEn));
    expect(text).toMatch(/^R\$\s?5\.1254 · Commercial · /);
    expect(norm(describeFxRate({ rate: 5.5, source: 'MANUAL', quotedAt: null, updatedAt: UPDATED }, 'en', tEn))).toContain('edited on');
  });

  test('sem fonte ou sem data: mostra só o que existe', () => {
    expect(norm(describeFxRate({ rate: 5, source: null, quotedAt: null, updatedAt: null }, 'pt-BR', tPt))).toBe('R$ 5,00');
    expect(norm(describeFxRate({ rate: 5, source: 'AWESOMEAPI', quotedAt: null, updatedAt: null }, 'pt-BR', tPt))).toBe('R$ 5,00 · Comercial');
    expect(norm(describeFxRate({ rate: 5, source: 'PTAX', quotedAt: null, updatedAt: null }, 'pt-BR', tPt))).toBe('R$ 5,00 · PTAX');
  });
});

describe('rótulos da fonte', () => {
  test('curto, completo e data para a dica do cabeçalho', () => {
    expect(fxSourceShort('AWESOMEAPI', tPt)).toBe('Comercial');
    expect(fxSourceShort(null, tPt)).toBeNull();
    expect(fxSourceName('AWESOMEAPI', tPt)).toBe('Comercial (AwesomeAPI)');
    expect(fxSourceName('PTAX', tPt)).toBe('PTAX do Banco Central');
    expect(fxDateText({ source: 'AWESOMEAPI', quotedAt: QUOTED, updatedAt: null }, 'pt-BR', tPt)).toContain('20/11/2026');
    expect(fxDateText({ source: 'MANUAL', quotedAt: null, updatedAt: null }, 'pt-BR', tPt)).toBeNull();
  });
});

describe('erros FX_* traduzidos com o nome da fonte', () => {
  const err = (code: string, source?: string) => new ApiRequestError(code, 'msg do backend', 502, source ? { params: { source } } : {});

  test('com params.source', () => {
    expect(errorMessageFor(err('FX_FETCH_FAILED', 'AWESOMEAPI'), tPt)).toContain('Comercial (AwesomeAPI)');
    expect(errorMessageFor(err('FX_RATE_LIMITED', 'AWESOMEAPI'), tPt)).toContain('Comercial (AwesomeAPI)');
    expect(errorMessageFor(err('FX_INVALID_RESPONSE', 'PTAX'), tEn)).toContain('Central Bank PTAX');
    expect(errorMessageFor(err('PTAX_NOT_FOUND', 'PTAX'), tPt)).toBe(
      'O Banco Central não publicou a PTAX nos últimos dias. Tente mais tarde, use a cotação comercial ou digite a cotação manualmente.',
    );
  });

  test('sem params, cai no texto genérico do código', () => {
    expect(errorMessageFor(err('FX_FETCH_FAILED'), tPt)).toBe(ptBR.errors.FX_FETCH_FAILED);
    expect(errorMessageFor(err('FX_REFRESH_IN_PROGRESS'), tEn)).toBe(en.errors.FX_REFRESH_IN_PROGRESS);
  });

  test('códigos removidos não existem mais nos dicionários', () => {
    for (const dict of [ptBR.errors, en.errors] as Record<string, string>[]) {
      for (const code of ['PTAX_FETCH_FAILED', 'PTAX_INVALID_RESPONSE', 'PTAX_REFRESH_IN_PROGRESS']) {
        expect(dict[code]).toBeUndefined();
      }
    }
  });
});
