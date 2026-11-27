import fs from 'node:fs';
import path from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, test, vi } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate } from '@/i18n/translate';
import { ApiRequestError, getMarketValueSummary, refreshMarketValues } from '@/services/api';
import type { IntegrationView, MarketValue, MarketValueRefreshResponse, MarketValueSummary, MarketValueTotals } from '@/types/api';
import { reportAutoImport, resetAutoImportProgressForTests, getAutoImportProgress, type AutoImportProgress } from './autoImportProgress';
import { agoParts, formatAgo } from './format';
import {
  groupMarketCell, groupUnrealizedCell, profitUnrealizedCard, profitValueCard, signOf, tabSummary, unitMarketCell, unitUnrealizedCell,
} from './marketValueDisplay';
import {
  BUSY_RETRY_DELAY_MS, BUSY_RETRY_MAX_WAIT_MS, decidePriceRefreshStart, nextAfterRefresh, START_DELAY_MS, type IntegrationQueryStatus,
} from './priceRefresh';
import { priceStatusView } from './priceStatus';
import { INVALIDATION_MAP, invalidateAfter, type InvalidationAction } from './queryInvalidation';
import { queryKeys } from './queryKeys';

// QA 10.6 (D365 e Adendo 1): decisão de quando buscar, resultado da busca, indicador, "há X", células, cards, invariantes de fonte e
// invalidação. Vitest em Node, sem render: lógica pura e leitura do código-fonte nos pontos de ligação. Sem rede (fetch falso).

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
// Sem comentários: o que importa é o código (um comentário pode citar "valor de mercado" à vontade).
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const integration = (extra: Partial<IntegrationView> = {}) => ({
  autoImportOnOpen: true, autoImportPaused: false, hasApiKey: true, storeId: 1, tradesCutoffAt: '2026-01-01T00:00:00.000Z', importInProgress: false, ...extra,
}) as IntegrationView;

// ---------------------------------------------------------------------------------------------------------------------------------
describe('decidePriceRefreshStart: importação devida, rodando, terminada, pulada, com erro e não devida', () => {
  const STATUSES: IntegrationQueryStatus[] = ['pending', 'success', 'error'];
  const PROGRESS: AutoImportProgress[] = ['IDLE', 'RUNNING', 'DONE'];
  const decide = (integrationStatus: IntegrationQueryStatus, autoImport: AutoImportProgress, view: IntegrationView | null) =>
    decidePriceRefreshStart({ integrationStatus, integration: view, autoImport });

  test('consulta pendente espera em qualquer estado da importação', () => {
    for (const progress of PROGRESS) {
      for (const view of [null, integration(), integration({ autoImportOnOpen: false })]) expect(decide('pending', progress, view)).toBe('WAIT');
    }
  });

  test('importação rodando espera, com consulta boa ou com erro', () => {
    for (const status of ['success', 'error'] as const) expect(decide(status, 'RUNNING', integration())).toBe('WAIT');
    expect(decide('error', 'RUNNING', null)).toBe('WAIT');
  });

  test('importação terminada (sucesso, pulada ou com erro: todas viram DONE) vai, mesmo que o card diga que ainda é devida', () => {
    for (const status of ['success', 'error'] as const) {
      for (const view of [integration(), null, integration({ importInProgress: true })]) expect(decide(status, 'DONE', view)).toBe('GO');
    }
  });

  test('importação devida e ainda IDLE espera; não devida vai já (cada motivo sozinho)', () => {
    expect(decide('success', 'IDLE', integration())).toBe('WAIT');
    const NOT_DUE: Partial<IntegrationView>[] = [
      { autoImportOnOpen: false }, { autoImportPaused: true }, { hasApiKey: false }, { storeId: null }, { tradesCutoffAt: null }, { importInProgress: true },
    ];
    for (const extra of NOT_DUE) expect(decide('success', 'IDLE', integration(extra)), JSON.stringify(extra)).toBe('GO');
  });

  test('consulta da integração com erro e sem dados vai já (o POST falha em silêncio)', () => {
    expect(decide('error', 'IDLE', null)).toBe('GO');
  });

  test('é uma função só do trio de entrada (sem relógio nem estado escondido): mesma entrada, mesma saída, todas as 27 combinações', () => {
    for (const status of STATUSES) {
      for (const progress of PROGRESS) {
        for (const view of [null, integration(), integration({ hasApiKey: false })]) {
          const first = decide(status, progress, view);
          expect(['WAIT', 'GO']).toContain(first);
          expect(decide(status, progress, view)).toBe(first);
        }
      }
    }
  });

  test('constantes: 1 s antes de buscar, 5 s antes da repetição por BUSY, teto de espera maior que a importação (270 s)', () => {
    expect(START_DELAY_MS).toBe(1000);
    expect(BUSY_RETRY_DELAY_MS).toBe(5000);
    expect(BUSY_RETRY_MAX_WAIT_MS).toBeGreaterThan(270000);
  });
});

describe('autoImportProgress (store)', () => {
  afterEach(() => resetAutoImportProgressForTests());
  test('IDLE -> RUNNING -> DONE; repetir o mesmo valor não muda nada; o reset volta a IDLE', () => {
    expect(getAutoImportProgress()).toBe('IDLE');
    reportAutoImport('RUNNING');
    reportAutoImport('RUNNING');
    expect(getAutoImportProgress()).toBe('RUNNING');
    reportAutoImport('DONE');
    expect(getAutoImportProgress()).toBe('DONE');
    resetAutoImportProgressForTests();
    expect(getAutoImportProgress()).toBe('IDLE');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('nextAfterRefresh: todo skipped, failed e erro', () => {
  const resp = (extra: Partial<MarketValueRefreshResponse>) => ({ skipped: null, result: null, failed: null, ...extra }) as MarketValueRefreshResponse;
  const result = (requested: number, fetched: number) => ({ requested, fetched }) as MarketValueRefreshResponse['result'];
  const STATUS = { action: 'DONE', invalidate: 'marketValues.status' } as const;
  const REFRESH = { action: 'DONE', invalidate: 'marketValues.refresh' } as const;

  test('BUSY: 1.ª vez repete; 2.ª para', () => {
    expect(nextAfterRefresh(resp({ skipped: 'BUSY' }), { retried: false })).toEqual({ action: 'RETRY_WHEN_IDLE', invalidate: 'marketValues.status' });
    expect(nextAfterRefresh(resp({ skipped: 'BUSY' }), { retried: true })).toEqual(STATUS);
  });

  test.each(['ALREADY_RAN', 'COOLDOWN', 'NOT_CONFIGURED', 'ALGO_NOVO'])('skipped %s termina só com o indicador, nas duas tentativas', (skipped) => {
    for (const retried of [false, true]) expect(nextAfterRefresh(resp({ skipped: skipped as never }), { retried })).toEqual(STATUS);
  });

  test('skipped ganha de um result que viesse junto (nunca recarrega itens)', () => {
    expect(nextAfterRefresh(resp({ skipped: 'COOLDOWN', result: result(3, 3) }), { retried: false })).toEqual(STATUS);
  });

  test('failed (com ou sem preços gravados antes da falha) só atualiza o indicador... ', () => {
    expect(nextAfterRefresh(resp({ failed: { code: 'IMPORT_SOURCE_UNREACHABLE' } as never }), { retried: false })).toEqual(STATUS);
  });

  test('result.fetched > 0 recarrega itens e resumo; 0 ou requested 0, só o indicador; result nulo sem skipped, só o indicador', () => {
    expect(nextAfterRefresh(resp({ result: result(2, 1) }), { retried: false })).toEqual(REFRESH);
    expect(nextAfterRefresh(resp({ result: result(2, 1) }), { retried: true })).toEqual(REFRESH);
    expect(nextAfterRefresh(resp({ result: result(2, 0) }), { retried: false })).toEqual(STATUS);
    expect(nextAfterRefresh(resp({ result: result(0, 0) }), { retried: false })).toEqual(STATUS);
    expect(nextAfterRefresh(resp({}), { retried: false })).toEqual(STATUS);
  });

  test('erros de rede, TIMEOUT e lixo (null, undefined, texto, objeto sem skipped) nunca relançam nem repetem', () => {
    const outcomes = [new Error('rede'), new ApiRequestError('TIMEOUT', 'tempo esgotado'), new ApiRequestError('NETWORK_ERROR', 'x'), null, undefined, 'x', 42, {}];
    for (const outcome of outcomes) {
      for (const retried of [false, true]) expect(nextAfterRefresh(outcome, { retried }), String(outcome)).toEqual(STATUS);
    }
  });

  test('o laço do host faz no máximo duas chamadas, qualquer que seja a sequência de respostas', () => {
    const sequences: unknown[][] = [
      [resp({ skipped: 'BUSY' }), resp({ skipped: 'BUSY' }), resp({ result: result(1, 1) })],
      [resp({ skipped: 'BUSY' }), resp({ result: result(1, 1) })],
      [new Error('x'), resp({ skipped: 'BUSY' })],
      [resp({ skipped: 'BUSY' }), new Error('x'), resp({ skipped: 'BUSY' })],
    ];
    for (const seq of sequences) {
      let calls = 0;
      let retried = false;
      for (;;) {
        const outcome = seq[calls];
        calls += 1;
        const next = nextAfterRefresh(outcome, { retried });
        if (next.action === 'RETRY_WHEN_IDLE') { retried = true; continue; }
        break;
      }
      expect(calls).toBeLessThanOrEqual(2);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('PriceAutoRefreshHost: disparo único, StrictMode, BUSY e silêncio (ligação pelo código-fonte)', () => {
  const host = code('components/PriceAutoRefreshHost.tsx');

  test('uma tentativa por carga: variável de módulo e useRef, conferidos antes de agendar e dentro do timer, marcados juntos', () => {
    expect(host).toMatch(/let attemptedThisPage = false;/);
    expect(host).toMatch(/const started = useRef\(false\);/);
    expect(host).toMatch(/if \(started\.current \|\| attemptedThisPage\) return undefined;/);
    const timerBody = host.slice(host.indexOf('setTimeout(() => {'));
    expect(timerBody).toMatch(/if \(started\.current \|\| attemptedThisPage\) return;\s*started\.current = true;\s*attemptedThisPage = true;/);
    expect(timerBody).toContain('START_DELAY_MS');
  });

  test('o efeito limpa o timer (o 1.º efeito do StrictMode não dispara) e só dispara quando decidePriceRefreshStart diz GO', () => {
    expect(host).toMatch(/return \(\) => clearTimeout\(timer\);/);
    expect(host).toMatch(/decidePriceRefreshStart\(\{ integrationStatus: status, integration, autoImport \}\) !== 'GO'\) return undefined/);
    expect(host).toMatch(/integrationQuery\.isPending \? 'pending' : integrationQuery\.isError \? 'error' : 'success'/);
  });

  test('BUSY: repete no máximo uma vez (retried), espera o importInProgress acabar e o tempo mínimo, e invalida a integração antes', () => {
    expect(host).toMatch(/let retried = false;/);
    expect(host).toMatch(/if \(next\.action === 'RETRY_WHEN_IDLE'\) \{\s*retried = true;/);
    expect(host).toContain("invalidate('integration.update')");
    expect(host).toContain('BUSY_RETRY_DELAY_MS');
    expect(host).toContain('BUSY_RETRY_MAX_WAIT_MS');
    expect(host).toMatch(/integrationRef\.current\?\.importInProgress/);
    expect((host.match(/RETRY_WHEN_IDLE/g) ?? []).length).toBe(1);
  });

  test('a mutação tem a chave que o indicador observa; depois do resultado invalida pela ação escolhida por nextAfterRefresh', () => {
    expect(host).toContain('mutationKey: PRICE_REFRESH_MUTATION_KEY');
    expect(read('components/useMarketSummary.ts')).toMatch(/PRICE_REFRESH_MUTATION_KEY = \['marketValues', 'refresh'\] as const/);
    expect(host).toMatch(/const action: 'marketValues\.refresh' \| 'marketValues\.status' = next\.invalidate;\s*await invalidate\(action\)/);
  });

  test('silêncio: não renderiza nada, não mostra aviso nem usa o modal de falta de conexão', () => {
    expect(host).toMatch(/return null;/);
    expect(host).not.toMatch(/reportStartup|StartupOfflineModal|setError|useState|alert\(|role="alert"/);
    expect(host).toMatch(/run\(\)\.catch\(\(\) => undefined\)/);
    expect(host).toMatch(/invalidate\(action\)\.catch\(\(\) => undefined\)/);
    // o try/catch em volta do POST engole o erro (vira o "outcome" que nextAfterRefresh trata)
    expect(host).toMatch(/try \{\s*outcome = await mutateAsync\(\);\s*\} catch \(err\) \{\s*outcome = err;/);
  });

  test('o layout monta o host de preços logo depois do da importação; o host da importação informa RUNNING e DONE (sucesso e erro)', () => {
    const layout = code('app/layout.tsx');
    expect(layout.indexOf('<CsfloatAutoImportHost />')).toBeGreaterThan(-1);
    expect(layout.indexOf('<PriceAutoRefreshHost />')).toBeGreaterThan(layout.indexOf('<CsfloatAutoImportHost />'));
    const importHost = code('components/CsfloatAutoImportHost.tsx');
    expect(importHost).toMatch(/reportAutoImport\('RUNNING'\);\s*runCsfloatImport/);
    expect((importHost.match(/reportAutoImport\('DONE'\)/g) ?? []).length).toBe(2);
    const thenPart = importHost.slice(importHost.indexOf('.then('), importHost.indexOf('.catch('));
    expect(thenPart).toContain("reportAutoImport('DONE')");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('priceStatusView: todos os tipos e a precedência', () => {
  const totals = (unitCount: number) => ({ unitCount }) as MarketValueTotals;
  const summary = (extra: Partial<MarketValueSummary> = {}) => ({
    configured: true, inProgress: false, lastRefreshAt: null, lastRun: null, totals: totals(3), ...extra,
  }) as MarketValueSummary;
  const run = (status: 'OK' | 'PARTIAL' | 'FAILED', errorCode: string | null = null) => ({ at: '2026-11-24T10:00:00.000Z', status, errorCode }) as MarketValueSummary['lastRun'];
  const AT = '2026-11-24T09:00:00.000Z';
  const view = (s: MarketValueSummary | null, refreshing = false) => priceStatusView({ summary: s, refreshing });

  test('REFRESHING: pela mutação ou pelo inProgress (outra aba), ganha de tudo e mantém a data anterior', () => {
    expect(view(summary({ lastRefreshAt: AT }), true)).toEqual({ kind: 'REFRESHING', at: AT, errorCode: null });
    expect(view(summary({ inProgress: true, lastRefreshAt: AT }))).toEqual({ kind: 'REFRESHING', at: AT, errorCode: null });
    expect(view(summary({ inProgress: true, configured: false, lastRun: run('FAILED', 'X'), totals: totals(0) })).kind).toBe('REFRESHING');
    expect(view(null, true)).toEqual({ kind: 'REFRESHING', at: null, errorCode: null });
  });

  test('NOT_CONFIGURED ganha de FAILED, UPDATED e NEVER, e carrega a data do cache', () => {
    expect(view(summary({ configured: false, lastRefreshAt: AT, lastRun: run('FAILED', 'X') }))).toEqual({ kind: 'NOT_CONFIGURED', at: AT, errorCode: null });
    expect(view(summary({ configured: false })).kind).toBe('NOT_CONFIGURED');
  });

  test('FAILED: com código, sem nenhum preço (at nulo) e com preços antigos (at preenchido); ganha de UPDATED', () => {
    expect(view(summary({ lastRun: run('FAILED', 'IMPORT_SOURCE_UNREACHABLE') }))).toEqual({ kind: 'FAILED', at: null, errorCode: 'IMPORT_SOURCE_UNREACHABLE' });
    expect(view(summary({ lastRun: run('FAILED', 'E'), lastRefreshAt: AT }))).toEqual({ kind: 'FAILED', at: AT, errorCode: 'E' });
  });

  test('UPDATED: OK e PARTIAL aparecem iguais (PARTIAL é só "atualizado")', () => {
    for (const status of ['OK', 'PARTIAL'] as const) expect(view(summary({ lastRun: run(status), lastRefreshAt: AT }))).toEqual({ kind: 'UPDATED', at: AT, errorCode: null });
    expect(view(summary({ lastRefreshAt: AT })).kind).toBe('UPDATED');
  });

  test('HIDDEN: estoque vazio sem preços, ou sem resumo ainda; NEVER: há unidades e nunca houve preço', () => {
    expect(view(summary({ totals: totals(0) })).kind).toBe('HIDDEN');
    expect(view(null).kind).toBe('HIDDEN');
    expect(view(undefined as never).kind).toBe('HIDDEN');
    expect(view(summary()).kind).toBe('NEVER');
    expect(view(summary({ lastRun: run('OK') })).kind).toBe('NEVER');
    // estoque vazio mas com preço antigo no cache: ainda diz "atualizado" (o texto vale para o cache)
    expect(view(summary({ totals: totals(0), lastRefreshAt: AT })).kind).toBe('UPDATED');
  });

  test('o argumento now é aceito e ignorado (sem relógio no cálculo)', () => {
    const s = summary({ lastRefreshAt: AT });
    expect(priceStatusView({ summary: s, refreshing: false, now: new Date(0) })).toEqual(priceStatusView({ summary: s, refreshing: false, now: new Date() }));
  });

  test('toda combinação devolve um kind conhecido', () => {
    const KINDS = ['REFRESHING', 'NOT_CONFIGURED', 'FAILED', 'UPDATED', 'HIDDEN', 'NEVER'];
    for (const refreshing of [false, true]) {
      for (const inProgress of [false, true]) {
        for (const configured of [false, true]) {
          for (const lastRun of [null, run('OK'), run('PARTIAL'), run('FAILED', 'E')]) {
            for (const lastRefreshAt of [null, AT]) {
              for (const unitCount of [0, 4]) {
                expect(KINDS).toContain(view(summary({ inProgress, configured, lastRun, lastRefreshAt, totals: totals(unitCount) }), refreshing).kind);
              }
            }
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('formatAgo e agoParts', () => {
  const now = new Date('2026-11-24T12:00:00.000Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const MIN = 60000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  test.each([
    [0, 'LESS_THAN_MINUTE', 0], [30000, 'LESS_THAN_MINUTE', 0], [MIN - 1, 'LESS_THAN_MINUTE', 0],
    [MIN, 'MINUTES', 1], [59 * MIN + 59999, 'MINUTES', 59],
    [HOUR, 'HOURS', 1], [23 * HOUR + 59 * MIN, 'HOURS', 23],
    [DAY, 'DAYS', 1], [3 * DAY + 5 * HOUR, 'DAYS', 3], [400 * DAY, 'DAYS', 400],
    [-5 * MIN, 'LESS_THAN_MINUTE', 0], [-3 * DAY, 'LESS_THAN_MINUTE', 0],
  ])('%i ms atrás -> %s %i', (ms, unit, count) => {
    expect(agoParts(ago(ms), now)).toEqual({ unit, count });
  });

  test('data inválida ou vazia não quebra e vira "menos de 1 min"', () => {
    expect(agoParts('lixo', now)).toEqual({ unit: 'LESS_THAN_MINUTE', count: 0 });
    expect(agoParts('', now)).toEqual({ unit: 'LESS_THAN_MINUTE', count: 0 });
  });

  test('o texto final usa as chaves common.ago.* nos dois idiomas', () => {
    const tFor = (messages: unknown) => (key: string, params?: Record<string, string | number>) => translate(messages, key, params);
    const cases: [number, string, string][] = [
      [10000, 'menos de 1 min', 'less than 1 min'], [5 * MIN, '5 min', '5 min'], [2 * HOUR, '2 h', '2 h'], [3 * DAY, '3 d', '3 d'],
    ];
    for (const [ms, pt, english] of cases) {
      expect(formatAgo(ago(ms), now, tFor(ptBR))).toBe(pt);
      expect(formatAgo(ago(ms), now, tFor(en))).toBe(english);
    }
  });

  test('a frase do indicador fica natural nos dois idiomas', () => {
    const text = (messages: unknown, time: string) => translate(messages, 'prices.status.updatedAgo', { time });
    expect(text(ptBR, '3 d')).toBe('Preços atualizados há 3 d');
    expect(text(en, '3 d')).toBe('Prices updated 3 d ago');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
const mv = (extra: Partial<MarketValue> = {}): MarketValue => ({
  marketValueUsdCents: 1000, parts: { baseCents: 1000, hangingCents: null, stickersInfoCents: 0, patchesInfoCents: 0 }, costUsdCents: 600, costEstimated: false,
  unrealizedUsdCents: 400, unrealizedNetUsdCents: 380, netUnavailableReason: null, pricedAt: '2026-11-24T10:00:00.000Z', isStale: false, status: 'OK',
  reason: null, isComplete: true, missing: [], basis: 'NAME', isEstimated: true, approxCurrency: 'BRL', approx: { marketValue: 5000, unrealized: 2000, unrealizedNet: 1900 }, ...extra,
});
const noPrice = (reason: MarketValue['reason']) => mv({ status: 'NO_PRICE', marketValueUsdCents: null, reason, unrealizedUsdCents: null, unrealizedNetUsdCents: null, approx: { marketValue: null, unrealized: null, unrealizedNet: null } });
const notPriceable = (reason: MarketValue['reason']) => ({ ...noPrice(reason), status: 'NOT_PRICEABLE' }) as MarketValue;

describe('célula de valor da unidade (unitMarketCell)', () => {
  test('sem marketValue (vendida, consumida, ausente) -> NONE', () => {
    expect(unitMarketCell(null)).toEqual({ kind: 'NONE' });
    expect(unitMarketCell(undefined)).toEqual({ kind: 'NONE' });
  });

  test('OK com as partes, a data do preço e o "≈ R$"', () => {
    const view = unitMarketCell(mv({ approx: { marketValue: 6250, unrealized: null, unrealizedNet: null } }));
    expect(view).toEqual({
      kind: 'OK', usdCents: 1000, approxCents: 6250, approxCurrency: 'BRL', pricedAt: '2026-11-24T10:00:00.000Z', stale: false, incomplete: false,
      parts: { itemCents: 1000, hangingCents: null, stickersInfoCents: 0, patchesInfoCents: 0 },
    });
  });

  test('sem cotação: approxCents nulo (a célula não desenha a linha "≈ R$")', () => {
    expect(unitMarketCell(mv({ approx: { marketValue: null, unrealized: null, unrealizedNet: null } }))).toMatchObject({ kind: 'OK', approxCents: null });
  });

  test('desatualizado, incompleto (sem o chaveiro) e os dois juntos', () => {
    expect(unitMarketCell(mv({ isStale: true }))).toMatchObject({ stale: true, incomplete: false });
    expect(unitMarketCell(mv({ isComplete: false, missing: ['HANGING'] }))).toMatchObject({ stale: false, incomplete: true });
    expect(unitMarketCell(mv({ isStale: true, isComplete: false }))).toMatchObject({ stale: true, incomplete: true });
  });

  test('o valor mostrado é o do backend: stickers e patches ficam só nas partes e nunca somam', () => {
    const view = unitMarketCell(mv({ marketValueUsdCents: 1250, parts: { baseCents: 1000, hangingCents: 250, stickersInfoCents: 4000, patchesInfoCents: 900 } }));
    expect(view).toMatchObject({ kind: 'OK', usdCents: 1250, parts: { itemCents: 1000, hangingCents: 250, stickersInfoCents: 4000, patchesInfoCents: 900 } });
  });

  test('valor 0 de verdade (preço 0 do anúncio) é OK, não "sem preço"', () => {
    expect(unitMarketCell(mv({ marketValueUsdCents: 0 }))).toMatchObject({ kind: 'OK', usdCents: 0 });
  });

  test.each([['NOT_FETCHED', 'NOT_FETCHED'], ['NOT_FOUND', 'NOT_FOUND'], [null, 'NOT_FETCHED'], ['NO_EXTERIOR', 'NOT_FETCHED']])('NO_PRICE com reason %s -> %s', (reason, expected) => {
    expect(unitMarketCell(noPrice(reason as never))).toEqual({ kind: 'NO_PRICE', reason: expected });
  });

  test.each([
    ['NO_EXTERIOR', 'NO_EXTERIOR'], ['PHASE_REQUIRED', 'PHASE_REQUIRED'], ['PHASE_UNMAPPED', 'PHASE_UNMAPPED'], ['NOT_PRICEABLE', 'NOT_PRICEABLE'],
    [null, 'NOT_PRICEABLE'], ['NOT_FETCHED', 'NOT_PRICEABLE'], ['NOT_FOUND', 'NOT_PRICEABLE'],
  ])('NOT_PRICEABLE com reason %s -> %s', (reason, expected) => {
    expect(unitMarketCell(notPriceable(reason as never))).toEqual({ kind: 'NOT_PRICEABLE', reason: expected });
  });

  test('status OK com valor nulo (dado inconsistente) cai em NONE, nunca em "US$ 0,00"', () => {
    expect(unitMarketCell(mv({ marketValueUsdCents: null }))).toEqual({ kind: 'NONE' });
  });

  test('todo motivo possível do tipo tem texto de dica nos dois idiomas (a célula traduz por inventory.marketValue.reason.*)', () => {
    const reasons = ['NO_EXTERIOR', 'PHASE_REQUIRED', 'PHASE_UNMAPPED', 'NOT_PRICEABLE', 'NOT_FETCHED', 'NOT_FOUND', 'NOT_FETCHED_NO_KEY'];
    for (const messages of [ptBR, en]) {
      for (const r of reasons) expect(translate(messages, `inventory.marketValue.reason.${r}`), r).not.toBe(`inventory.marketValue.reason.${r}`);
    }
  });

  test('a célula escolhe a dica "sem chave" só para NOT_FETCHED sem chave configurada (ligação pelo código-fonte)', () => {
    const cell = code('components/MarketValueCell.tsx');
    expect(cell).toMatch(/const noKey = view\.reason === 'NOT_FETCHED' && summary !== null && !summary\.configured;/);
    expect(cell).toContain("NOT_FETCHED_NO_KEY");
    // a dica vai num HelpTip (teclado e leitor de tela), nunca no title (12.5a)
    expect(cell).toMatch(/\{title && <HelpTip topic=/);
    expect(cell).not.toMatch(/title=\{title \?\? undefined\}/);
  });
});

describe('PnL não realizado da unidade (unitUnrealizedCell)', () => {
  test('sinal e cor: positivo, negativo e zero (sem sinal, sem cor)', () => {
    expect(unitUnrealizedCell(mv({ unrealizedNetUsdCents: 1 }))).toMatchObject({ kind: 'NET', sign: 'POSITIVE', cents: 1 });
    expect(unitUnrealizedCell(mv({ unrealizedNetUsdCents: -1 }))).toMatchObject({ kind: 'NET', sign: 'NEGATIVE', cents: -1 });
    expect(unitUnrealizedCell(mv({ unrealizedNetUsdCents: 0 }))).toMatchObject({ kind: 'NET', sign: 'ZERO', cents: 0 });
    expect(signOf(5)).toBe('POSITIVE');
    expect(signOf(-5)).toBe('NEGATIVE');
    expect(signOf(0)).toBe('ZERO');
  });

  test('o principal é o líquido; o bruto só vai para a dica', () => {
    expect(unitUnrealizedCell(mv({ unrealizedNetUsdCents: 380, unrealizedUsdCents: 400 }))).toMatchObject({ cents: 380, grossCents: 400 });
  });

  test('"≈ R$" some sem cotação', () => {
    expect(unitUnrealizedCell(mv({ approx: { marketValue: null, unrealized: null, unrealizedNet: null } }))).toMatchObject({ kind: 'NET', approxCents: null });
  });

  test.each(['NO_INTEGRATION_STORE', 'FEES_NOT_CONFIGURED', 'NET_NOT_COMPUTABLE'] as const)('sem líquido (%s): "—" com o motivo e o bruto', (reason) => {
    expect(unitUnrealizedCell(mv({ unrealizedNetUsdCents: null, netUnavailableReason: reason }))).toEqual({ kind: 'NET_UNAVAILABLE', reason, grossCents: 400 });
  });

  test('sem líquido e sem motivo no dado: cai em NET_NOT_COMPUTABLE; bruto nulo é repassado nulo', () => {
    expect(unitUnrealizedCell(mv({ unrealizedNetUsdCents: null, netUnavailableReason: null }))).toMatchObject({ reason: 'NET_NOT_COMPUTABLE' });
    expect(unitUnrealizedCell(mv({ unrealizedNetUsdCents: null, netUnavailableReason: 'NO_INTEGRATION_STORE', unrealizedUsdCents: null }))).toMatchObject({ grossCents: null });
  });

  test('custo desconhecido, sem preço, sem avaliação e sem dado -> NONE', () => {
    expect(unitUnrealizedCell(mv({ costUsdCents: null }))).toEqual({ kind: 'NONE' });
    expect(unitUnrealizedCell(noPrice('NOT_FETCHED'))).toEqual({ kind: 'NONE' });
    expect(unitUnrealizedCell(notPriceable('PHASE_REQUIRED'))).toEqual({ kind: 'NONE' });
    expect(unitUnrealizedCell(null)).toEqual({ kind: 'NONE' });
  });

  test('custo 0 (GANHEI) é custo conhecido: o PnL aparece', () => {
    expect(unitUnrealizedCell(mv({ costUsdCents: 0, unrealizedNetUsdCents: 980 }))).toMatchObject({ kind: 'NET', cents: 980 });
  });
});

const totals = (extra: Partial<MarketValueTotals> = {}): MarketValueTotals => ({
  marketValueUsdCents: 3000, costUsdCents: 2000, unrealizedUsdCents: 1000, unrealizedNetUsdCents: 900, costEstimated: false, pricedUnits: 3, netUnits: 3,
  unpricedUnits: 0, notPriceableUnits: 0, staleUnits: 0, unitCount: 3, approxCurrency: 'BRL', approx: { marketValue: 15000, unrealized: 5000, unrealizedNet: 4500 }, ...extra,
});

describe('célula de grupo, resumo da aba e cards', () => {
  test('grupo: vazio, N de N, parcial, desatualizados, todos sem preço, todos sem avaliação, misto sem nenhum preço', () => {
    expect(groupMarketCell(null)).toEqual({ kind: 'NONE' });
    expect(groupMarketCell(totals({ unitCount: 0, pricedUnits: 0 }))).toEqual({ kind: 'NONE' });
    expect(groupMarketCell(totals())).toEqual({ kind: 'OK', usdCents: 3000, approxCents: 15000, approxCurrency: 'BRL', pricedUnits: 3, unitCount: 3, partial: false, staleUnits: 0 });
    expect(groupMarketCell(totals({ pricedUnits: 1, unitCount: 3, staleUnits: 1 }))).toMatchObject({ partial: true, staleUnits: 1 });
    expect(groupMarketCell(totals({ pricedUnits: 0, unpricedUnits: 3 }))).toEqual({ kind: 'NO_PRICE', unpricedUnits: 3, notPriceableUnits: 0 });
    expect(groupMarketCell(totals({ pricedUnits: 0, notPriceableUnits: 3 }))).toEqual({ kind: 'NOT_PRICEABLE', unpricedUnits: 0, notPriceableUnits: 3 });
    expect(groupMarketCell(totals({ pricedUnits: 0, unpricedUnits: 1, notPriceableUnits: 2 }))).toMatchObject({ kind: 'NO_PRICE' });
    expect(groupMarketCell(totals({ approx: { marketValue: null, unrealized: null, unrealizedNet: null } }))).toMatchObject({ kind: 'OK', approxCents: null });
  });

  test('grupo: não realizado completo, parcial, sem líquido (bruto na dica), sem preço', () => {
    expect(groupUnrealizedCell(totals())).toMatchObject({ kind: 'NET', partial: false, sign: 'POSITIVE', cents: 900, grossCents: 1000 });
    expect(groupUnrealizedCell(totals({ netUnits: 1, pricedUnits: 3 }))).toMatchObject({ kind: 'NET', partial: true });
    expect(groupUnrealizedCell(totals({ unrealizedNetUsdCents: -300 }))).toMatchObject({ sign: 'NEGATIVE', cents: -300 });
    expect(groupUnrealizedCell(totals({ unrealizedNetUsdCents: 0, netUnits: 3 }))).toMatchObject({ kind: 'NET', sign: 'ZERO' });
    expect(groupUnrealizedCell(totals({ netUnits: 0, unrealizedNetUsdCents: 0 }))).toEqual({ kind: 'NET_UNAVAILABLE', grossCents: 1000 });
    expect(groupUnrealizedCell(totals({ pricedUnits: 0, netUnits: 0 }))).toEqual({ kind: 'NONE' });
    expect(groupUnrealizedCell(null)).toEqual({ kind: 'NONE' });
  });

  test('líquido total 0 real (netUnits > 0) é "NET zero"; sem líquido (netUnits 0) é "indisponível" mesmo com o total também 0', () => {
    expect(profitUnrealizedCard(totals({ unrealizedNetUsdCents: 0, netUnits: 2, pricedUnits: 2 }))).toMatchObject({ kind: 'NET', sign: 'ZERO', partial: false });
    expect(profitUnrealizedCard(totals({ unrealizedNetUsdCents: 0, netUnits: 0, pricedUnits: 2 }))).toMatchObject({ kind: 'UNAVAILABLE' });
    expect(tabSummary(totals({ unrealizedNetUsdCents: 0, netUnits: 2 }))).toMatchObject({ netCents: 0, netSign: 'ZERO' });
    expect(tabSummary(totals({ unrealizedNetUsdCents: 0, netUnits: 0 }))).toMatchObject({ netCents: null, netSign: null, netApproxCents: null });
  });

  test('resumo da aba: some sem unidades ou sem preço; traz a cobertura', () => {
    expect(tabSummary(null)).toBeNull();
    expect(tabSummary(totals({ unitCount: 0, pricedUnits: 0 }))).toBeNull();
    expect(tabSummary(totals({ pricedUnits: 0, unpricedUnits: 3 }))).toBeNull();
    expect(tabSummary(totals({ pricedUnits: 2, unitCount: 5 }))).toMatchObject({ pricedUnits: 2, unitCount: 5, usdCents: 3000, approxCents: 15000 });
  });

  test('card de valor: sem preço nunca vira US$ 0,00; preço real 0 com unidade avaliada é OK; desatualizados e cobertura repassados', () => {
    expect(profitValueCard(totals({ pricedUnits: 0, marketValueUsdCents: 0 }))).toEqual({ kind: 'NO_PRICE' });
    expect(profitValueCard(totals({ pricedUnits: 1, marketValueUsdCents: 0 }))).toMatchObject({ kind: 'OK', usdCents: 0 });
    expect(profitValueCard(totals({ pricedUnits: 2, unitCount: 5, staleUnits: 1 }))).toEqual({
      kind: 'OK', usdCents: 3000, approxCents: 15000, approxCurrency: 'BRL', pricedUnits: 2, unitCount: 5, staleUnits: 1,
    });
  });

  test('card de PnL: sem preço, indisponível (bruto), parcial (netUnits < pricedUnits), completo, sinal, sem cotação', () => {
    expect(profitUnrealizedCard(totals({ pricedUnits: 0, netUnits: 0 }))).toEqual({ kind: 'NO_PRICE' });
    expect(profitUnrealizedCard(totals({ netUnits: 0, unrealizedUsdCents: -250 }))).toEqual({ kind: 'UNAVAILABLE', grossCents: -250 });
    expect(profitUnrealizedCard(totals({ netUnits: 1 }))).toMatchObject({ kind: 'NET', partial: true });
    expect(profitUnrealizedCard(totals())).toMatchObject({ kind: 'NET', partial: false, sign: 'POSITIVE', cents: 900 });
    expect(profitUnrealizedCard(totals({ unrealizedNetUsdCents: -1 }))).toMatchObject({ sign: 'NEGATIVE' });
    expect(profitUnrealizedCard(totals({ approx: { marketValue: null, unrealized: null, unrealizedNet: null } }))).toMatchObject({ kind: 'NET', approxCents: null });
  });

  test('os cards usam só números do backend: nenhuma função some valores (conta direta nos tipos de retorno)', () => {
    const t = totals({ marketValueUsdCents: 12345, unrealizedNetUsdCents: -678, approx: { marketValue: 61725, unrealized: 1, unrealizedNet: -3390 } });
    expect(profitValueCard(t)).toMatchObject({ usdCents: 12345, approxCents: 61725 });
    expect(profitUnrealizedCard(t)).toMatchObject({ cents: -678, approxCents: -3390 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('os cards do Lucro real (ligação pelo código-fonte, Adendo 1 da D365)', () => {
  const cards = code('components/MarketValueCards.tsx');
  const summaryCards = code('components/SummaryCards.tsx');

  test('os dois cards entram logo depois de "Estoque (pelo custo)" e antes dos cards de estoque à venda e em holding', () => {
    const stock = summaryCards.indexOf("t('profit.summary.stock')");
    const market = summaryCards.indexOf('<MarketValueCards />');
    const forSale = summaryCards.indexOf("t('profit.summary.stockForSale')");
    expect(stock).toBeGreaterThan(-1);
    expect(market).toBeGreaterThan(stock);
    expect(forSale).toBeGreaterThan(market);
    expect((summaryCards.match(/<MarketValueCards \/>/g) ?? []).length).toBe(1);
  });

  test('só dois cards (valor e PnL), cada um com a legenda "estimado — não entra no lucro real"', () => {
    expect((cards.match(/className=\{styles\.card\}/g) ?? []).length).toBe(2);
    expect(cards).toContain('data-testid="market-value-card"');
    expect(cards).toContain('data-testid="market-pnl-card"');
    expect((cards.match(/t\('profit\.market\.badge'\)/g) ?? []).length).toBe(2);
    expect(translate(ptBR, 'profit.market.badge')).toBe('estimado — não entra no lucro real');
    expect(translate(en, 'profit.market.badge')).toMatch(/estimated/i);
  });

  test('somem sem estoque e usam o total (à venda + holding) no valor; a divisão vai só na dica (title e srOnly)', () => {
    expect(cards).toMatch(/if \(!summary \|\| summary\.totals\.unitCount === 0\) return null;/);
    expect(cards).toMatch(/profitValueCard\(totals\)/);
    expect(cards).toMatch(/profitUnrealizedCard\(totals\)/);
    expect(cards).toContain('byState.forSale.marketValueUsdCents');
    expect(cards).toContain('byState.holding.marketValueUsdCents');
    expect(cards).toMatch(/title=\{valueHint\}/);
    expect(cards).toMatch(/<span className=\{styles\.srOnly\}>\{valueHint\}<\/span>/);
    expect(cards).toMatch(/title=\{pnlHint\}/);
    expect(cards).toMatch(/<span className=\{styles\.srOnly\}>\{pnlHint\}<\/span>/);
  });

  test('dica da divisão: valor de cada lado, ou "sem preço" (nunca US$ 0,00 inventado)', () => {
    expect(cards).toMatch(/byState\.forSale\.pricedUnits > 0 \?/);
    expect(cards).toMatch(/byState\.holding\.pricedUnits > 0 \?/);
    expect(translate(ptBR, 'profit.market.split', { forSale: 'A', holding: 'B' })).toBe('À venda: A · Holding: B');
  });

  test('o card de valor leva o indicador de preços; o PnL "indisponível" leva o bruto na dica', () => {
    expect(cards).toContain('<PriceStatusIndicator />');
    expect(cards).toMatch(/pnl\.kind === 'UNAVAILABLE'\s*\?\s*`\$\{t\('profit\.market\.pnlHint'\)\} \$\{t\('profit\.market\.unavailableHint'/);
    expect(cards).toMatch(/pnl\.kind === 'NET' && pnl\.partial/);
  });

  test('cor e sinal: o sinal "+" ou "−" vem no texto (não depende só da cor)', () => {
    expect(cards).toMatch(/cents > 0 \? `\+\$\{abs\}` : cents < 0 \? `−\$\{abs\}` : abs/);
    expect(cards).toMatch(/pnl\.kind === 'NET' \? signClass\(pnl\.sign\) : ''/);
  });

  test('"≈" no card de valor (MoneyApprox estimado) e no PnL só com cotação (approxCents não nulo), na moeda que veio', () => {
    expect(cards).toMatch(/<MoneyApprox cents=\{value\.usdCents\} estimated approxCents=\{value\.approxCents\} approxCurrency=\{value\.approxCurrency\} \/>/);
    expect(cards).toMatch(/pnl\.approxCents !== null &&/);
  });
});

describe('invariante forte: o valor de mercado nunca interfere no lucro real (teste de fonte)', () => {
  const IMPORT_LINES = (rel: string) => code(rel).split(/\r?\n/).filter((line) => /^\s*import\b/.test(line) || /^\s*\}\s*from\s/.test(line)).map((line) => line.trim()).join('\n');
  const MARKET = /marketValue|MarketValue|valuation|useMarketSummary|PriceStatus|priceStatus|priceRefresh|market-values|Market/;

  test('SummaryCards importa do valor de mercado só o componente filho MarketValueCards (nenhuma função de cálculo, consulta ou tipo)', () => {
    const imports = IMPORT_LINES('components/SummaryCards.tsx');
    const marketImports = imports.split('\n').filter((l) => MARKET.test(l));
    expect(marketImports).toEqual(["import MarketValueCards from './MarketValueCards';"]);
  });

  test('SummaryCards não usa nenhuma chave, consulta nem campo do valor de mercado fora do componente filho', () => {
    const body = code('components/SummaryCards.tsx').replace("import MarketValueCards from './MarketValueCards';", '').replace('<MarketValueCards />', '');
    expect(body).not.toMatch(/marketValue|MarketValue|unrealized|queryKeys\.marketValues|getMarketValueSummary|netUnits|approx\.marketValue/);
  });

  test('a consulta do resumo do lucro real continua a mesma (profitSummary) e a do valor de mercado é separada (marketValues.summary)', () => {
    expect(code('components/SummaryCards.tsx')).toMatch(/queryKeys\.profitSummary/);
    expect(code('components/useMarketSummary.ts')).toMatch(/queryKeys\.marketValues\.summary/);
    expect(code('components/MarketValueCards.tsx')).not.toMatch(/profitSummary|getProfitSummary|ProfitSummary/);
  });

  test('nenhuma outra tela do lucro real (page, cards de saldo, aportes, saques) importa valor de mercado', () => {
    const files = ['app/profit/page.tsx', 'components/SummaryCards.tsx'];
    for (const rel of ['components/DepositsSection.tsx', 'components/WithdrawalsSection.tsx', 'components/StoreBalancesPanel.tsx']) {
      if (fs.existsSync(path.join(SRC, rel))) files.push(rel);
    }
    for (const rel of files) {
      if (!fs.existsSync(path.join(SRC, rel))) continue;
      const hits = IMPORT_LINES(rel).split('\n').filter((l) => MARKET.test(l) && !l.includes("./MarketValueCards"));
      expect(hits, rel).toEqual([]);
    }
  });

  test('os módulos puros do valor de mercado não importam nada do lucro real, do preço mínimo nem do itemStats', () => {
    for (const rel of ['lib/marketValueDisplay.ts', 'lib/priceRefresh.ts', 'lib/priceStatus.ts', 'lib/autoImportProgress.ts']) {
      expect(IMPORT_LINES(rel), rel).not.toMatch(/profit|minPrice|itemStats|SummaryCards/i);
    }
  });

  test('o tipo ProfitSummary não tem campo de valor de mercado', () => {
    const types = read('types/api.ts');
    const block = types.slice(types.indexOf('export interface ProfitSummary'));
    const body = block.slice(0, block.indexOf('\n}\n'));
    expect(body.length).toBeGreaterThan(100);
    expect(body).not.toMatch(/marketValue|unrealized|netUnits/i);
  });

  test('backend: nenhum serviço do lucro real, do itemStats, do preço mínimo ou dos saldos importa o cálculo de valor (coberto em valuation.106.qa.test.js)', () => {
    const backendServices = path.join(SRC, '..', '..', 'backend', 'src', 'services');
    if (!fs.existsSync(backendServices)) return;
    for (const file of ['profitService.js', 'itemStatsService.js', 'pricingService.js', 'storeBalanceService.js']) {
      const full = path.join(backendServices, file);
      if (!fs.existsSync(full)) continue;
      expect(fs.readFileSync(full, 'utf8').replace(/\/\/.*$/gm, '')).not.toMatch(/require\([^)]*(valuationService|valuationIndex|marketValueService|marketHashName|MarketPrice)/);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('invalidação (D365 item 2)', () => {
  const groupsOf = (action: InvalidationAction): string[] => {
    const entry = INVALIDATION_MAP[action];
    return entry === 'clear' ? [] : (entry as readonly (readonly unknown[])[]).map((k) => String(k[0]));
  };
  const ACTIONS = Object.keys(INVALIDATION_MAP) as InvalidationAction[];

  test('toda ação que invalida items invalida marketValues (e a recíproca vale para as ações de valor/loja da integração)', () => {
    for (const action of ACTIONS) {
      const groups = groupsOf(action);
      if (groups.includes('items')) expect(groups, action).toContain('marketValues');
    }
  });

  test('integration.apiKey, integration.update e integration.switchAccount invalidam marketValues; update e switchAccount também items', () => {
    for (const action of ['integration.apiKey', 'integration.update', 'integration.switchAccount'] as const) expect(groupsOf(action), action).toContain('marketValues');
    for (const action of ['integration.update', 'integration.switchAccount'] as const) expect(groupsOf(action), action).toContain('items');
    expect(groupsOf('integration.test')).not.toContain('marketValues');
  });

  test('holding e volta à venda (individual e em lote), aging, catálogo e loja Steam invalidam marketValues', () => {
    for (const action of ['item.offSale', 'item.offSaleBulk', 'item.backOnSale', 'item.backOnSaleBulk', 'settings.aging', 'catalog.refresh', 'settings.steamStore'] as const) {
      expect(groupsOf(action), action).toContain('marketValues');
    }
  });

  test('cotação e todo o grupo de dinheiro (lojas, saldos, aportes, saques) recarregam o "≈ R$": settings.fx invalida marketValues', () => {
    expect(groupsOf('settings.fx')).toContain('marketValues');
    for (const action of ['store.create', 'store.update', 'store.delete', 'import.run', 'import.undo', 'import.resolve'] as const) expect(groupsOf(action), action).toContain('marketValues');
  });

  test('ações novas: refresh = items + marketValues; status = só marketValues; nenhuma toca lucro real, saldos, aportes ou saques', () => {
    expect(groupsOf('marketValues.refresh').sort()).toEqual(['items', 'marketValues']);
    expect(groupsOf('marketValues.status')).toEqual(['marketValues']);
    for (const action of ['marketValues.refresh', 'marketValues.status'] as const) {
      for (const forbidden of ['profitSummary', 'storeBalances', 'deposits', 'withdrawals', 'stores', 'sales']) expect(groupsOf(action), `${action} não deve invalidar ${forbidden}`).not.toContain(forbidden);
    }
  });

  test('backup.import continua limpando o cache inteiro', () => {
    expect(INVALIDATION_MAP['backup.import']).toBe('clear');
  });

  test('na prática: marketValues.status invalida só o resumo; marketValues.refresh invalida itens e resumo; o lucro real fica intacto', async () => {
    const client = new QueryClient();
    const seed = () => {
      client.clear();
      client.setQueryData(queryKeys.marketValues.summary, { x: 1 });
      client.setQueryData(queryKeys.items.all, { x: 1 });
      client.setQueryData(queryKeys.profitSummary.all, { x: 1 });
    };
    const invalidated = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;
    seed();
    await invalidateAfter(client, 'marketValues.status');
    expect([invalidated(queryKeys.marketValues.summary), invalidated(queryKeys.items.all), invalidated(queryKeys.profitSummary.all)]).toEqual([true, false, false]);
    seed();
    await invalidateAfter(client, 'marketValues.refresh');
    expect([invalidated(queryKeys.marketValues.summary), invalidated(queryKeys.items.all), invalidated(queryKeys.profitSummary.all)]).toEqual([true, true, false]);
    seed();
    await invalidateAfter(client, 'item.offSale');
    expect([invalidated(queryKeys.marketValues.summary), invalidated(queryKeys.profitSummary.all)]).toEqual([true, true]);
  });

  test('chaves: marketValues.all é prefixo de marketValues.summary (a invalidação por prefixo alcança o resumo)', () => {
    expect(queryKeys.marketValues.summary.slice(0, queryKeys.marketValues.all.length)).toEqual([...queryKeys.marketValues.all]);
  });

  test('toda tela que muda dados da integração ou do holding usa uma ação do mapa que alcança marketValues (a ação existe)', () => {
    for (const action of ['integration.apiKey', 'integration.update', 'item.offSale', 'item.backOnSale', 'marketValues.refresh', 'marketValues.status'] as const) {
      expect(ACTIONS).toContain(action);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('cliente da API do valor de mercado', () => {
  afterEach(() => vi.unstubAllGlobals());
  const okBody = { success: true, data: { skipped: null, result: { requested: 1, fetched: 1 }, failed: null } };

  test('POST: corpo {}, JSON, caminho certo; prazo de 270 s no código; GET do resumo sem corpo', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => okBody });
    vi.stubGlobal('fetch', fetchMock);
    expect(await refreshMarketValues()).toEqual(okBody.data);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/market-values\/refresh$/);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(read('services/api.ts')).toMatch(/'POST', '\/market-values\/refresh', \{ body: \{\}, timeoutMs: 270000 \}/);

    await getMarketValueSummary();
    const [url2, init2] = fetchMock.mock.calls[1];
    expect(String(url2)).toMatch(/\/api\/market-values\/summary$/);
    expect(init2.method).toBe('GET');
    expect(init2.body).toBeUndefined();
  });

  test('o GET repassa o AbortSignal', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await getMarketValueSummary(controller.signal);
    expect(fetchMock.mock.calls[0][1].signal).toBeDefined();
  });

  test('{ success: false } vira ApiRequestError com o código; rede fora do ar também rejeita (o host trata em silêncio)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ success: false, error: { code: 'VALUATION_IN_PROGRESS', message: 'm' } }) }));
    await expect(refreshMarketValues()).rejects.toBeInstanceOf(ApiRequestError);
    await expect(refreshMarketValues()).rejects.toMatchObject({ code: 'VALUATION_IN_PROGRESS' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(refreshMarketValues()).rejects.toBeInstanceOf(ApiRequestError);
  });

  test('o resultado de erro vira "só o indicador" em nextAfterRefresh (fim a fim, sem relançar)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    let outcome: unknown;
    try {
      outcome = await refreshMarketValues();
    } catch (err) {
      outcome = err;
    }
    expect(nextAfterRefresh(outcome, { retried: false })).toEqual({ action: 'DONE', invalidate: 'marketValues.status' });
  });
});
