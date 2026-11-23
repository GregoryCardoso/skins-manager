import fs from 'node:fs';
import path from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { API_ERROR_CODES } from '@/i18n/errorCodes';
import { translate, translatePlural } from '@/i18n/translate';
import { INVALIDATION_MAP } from '@/lib/queryInvalidation';
import { queryKeys } from '@/lib/queryKeys';
import { COUNT_LINES, groupEntries, isNothingNew, summaryLines } from '@/lib/importSummary';
import { suggestionToInputValue, validateCutoffInput } from '@/lib/importCutoff';
import type { ImportBatchCounts, ImportBatchView, ImportEntryView, IntegrationView } from '@/types/api';

// QA 9.2 (D305, D318): frontend da importação do CSFloat. Sem jsdom: renderização estática com os dados no cache, análise do
// código-fonte para o que depende de clique, i18n (pt-BR e en) e o mapa de invalidação. Dados inventados.
const LANG = { current: 'pt-BR' as 'pt-BR' | 'en' };
const dict = () => (LANG.current === 'en' ? en : ptBR);
vi.mock('@/i18n/I18nProvider', () => {
  const t = (key: string, params?: Record<string, string | number>) => translate(dict(), key, params);
  const tPlural = (key: string, count: number, params?: Record<string, string | number>) => translatePlural(dict(), key, count, LANG.current, params);
  return { useT: () => t, useTLoose: () => t, useTPlural: () => tPlural, useLanguage: () => LANG.current };
});

import ImportButton from './ImportButton';
import ImportCutoffModal from './ImportCutoffModal';
import ImportEntriesList from './ImportEntriesList';
import ImportSummaryModal from './ImportSummaryModal';
import { importDisabledReason } from './useCsfloatImport';

const SRC = path.join(__dirname, '..');
const read = (...parts: string[]) => fs.readFileSync(path.join(SRC, ...parts), 'utf8');
const BACKEND_SRC = path.join(__dirname, '..', '..', '..', 'backend', 'src');

type Json = { [key: string]: Json | string };
function leaves(node: Json | string, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  return Object.entries(node).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
}
const pick = (tree: Json, ...keys: string[]) => keys.reduce<Json | string>((node, key) => (node as Json)[key], tree) as Json;
const ZERO: ImportBatchCounts = {
  purchasesCreated: 0, salesCreated: 0, matched: 0, known: 0, beforeCutoff: 0, notTransferred: 0, review: 0, reverted: 0, failed: 0,
  unknownState: 0, deferredSales: 0, withoutPurchase: 0,
};

const baseView: IntegrationView = {
  source: 'CSFLOAT', storeId: 1, storeName: 'CSFloat', storeCurrency: 'USD', storeSaleFeeRate: 0.02, storeWithdrawalFeeRate: 0.025,
  hasApiKey: true, apiKeyMasked: '****a1b2', apiKeySavedAt: '2026-11-20T10:00:00.000Z', accountLinked: true, autoImportOnOpen: false, autoImportPaused: false,
  tradesCutoffAt: null, transactionsCutoffAt: null, lastImportAt: null, lastImportStatus: null, lastImportErrorCode: null,
  importInProgress: false, openEntriesCount: 0, suggestedCutoffAt: null, helpUrl: 'https://csfloat.com/profile',
};

function entry(id: number, outcome: ImportEntryView['outcome'], extra: Partial<ImportEntryView> = {}, display: Partial<ImportEntryView['display']> = {}): ImportEntryView {
  return {
    id, batchId: 1, outcome, reasonCode: null, entityType: null, entityId: null, candidateIds: [], resolution: null, resolvedAt: null,
    display: {
      direction: 'BUY', marketHashName: 'AK-47 | Redline (Field-Tested)', name: 'AK-47 | Redline', namePtBr: 'AK-47 | Linha Vermelha', imageUrl: null,
      catalogId: 'skin-ak-redline', category: 'SKIN', variant: 'NORMAL', floatValue: 0.2534, paintSeed: 661, phase: null, priceCents: 1250,
      currency: 'USD', date: '2026-11-20T14:00:00.000Z', state: 'pending', ...display,
    },
    ...extra,
  };
}

function batch(extra: Partial<ImportBatchView> = {}): ImportBatchView {
  return {
    id: 7, source: 'CSFLOAT', trigger: 'MANUAL', status: 'DONE', startedAt: '2026-11-22T15:00:00.000Z', finishedAt: '2026-11-22T15:00:03.000Z', fullScan: false,
    cutoffAt: '2026-11-01T00:00:00.000Z', pagesRead: { trades: 1, transactions: 1 }, counts: { ...ZERO }, warnings: [], unknownTypes: {}, errorCode: null,
    undoneAt: null, undoable: false, openEntriesCount: 0, entries: [], ...extra,
  } as unknown as ImportBatchView;
}

function client(view: IntegrationView | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (view) qc.setQueryData(queryKeys.integrations.csfloat, view);
  return qc;
}
const render = (node: ReturnType<typeof createElement>, view: IntegrationView | null = baseView, lang: 'pt-BR' | 'en' = 'pt-BR') => {
  LANG.current = lang;
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: client(view) }, node));
};

// --- i18n ------------------------------------------------------------------------------------------------------------------

describe('i18n da importação: pt-BR e en', () => {
  test('imports.* tem exatamente as mesmas chaves nos dois idiomas, nenhuma vazia', () => {
    const a = leaves(pick(ptBR as Json, 'imports')).sort();
    const b = leaves(pick(en as Json, 'imports')).sort();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(40);
    for (const lang of [ptBR, en]) {
      const flat = leaves(pick(lang as Json, 'imports'));
      for (const key of flat) expect(translate(lang as never, `imports.${key}`)).not.toBe('');
    }
  });

  test('todas as chaves de imports.counts existem para as linhas do resumo, com plural one/other', () => {
    for (const key of COUNT_LINES) {
      for (const [lang, code] of [[ptBR, 'pt-BR'], [en, 'en']] as const) {
        expect(translatePlural(lang as never, `imports.counts.${key}`, 1, code)).toMatch(/1/);
        expect(translatePlural(lang as never, `imports.counts.${key}`, 5, code)).toMatch(/5/);
      }
    }
  });

  test('os textos pt-BR não são cópias do inglês (nenhuma chave de imports igual nos dois, salvo nomes próprios)', () => {
    const same = leaves(pick(ptBR as Json, 'imports')).filter((key) => translate(ptBR as never, `imports.${key}`) === translate(en as never, `imports.${key}`));
    expect(same.filter((key) => !/(^|\.)(badge|manual)$/.test(key))).toEqual([]);
  });

  test('todo motivo (reasonCode) que o backend grava tem texto em imports.reasons ou em errors, nos dois idiomas', () => {
    const files = fs.readdirSync(path.join(BACKEND_SRC, 'services', 'imports')).filter((f) => f.endsWith('.js'));
    const codes = new Set<string>();
    for (const file of files) {
      const text = fs.readFileSync(path.join(BACKEND_SRC, 'services', 'imports', file), 'utf8');
      for (const match of text.matchAll(/reasonCode:\s*'([A-Z_]+)'/g)) codes.add(match[1]);
      if (file === 'externalItemMapper.js') for (const match of text.matchAll(/reason:\s*'([A-Z_]+)'/g)) codes.add(match[1]);
    }
    // os motivos que pertencem às partes seguintes (9.3 em diante) ainda não têm tela
    const later = new Set(['PURCHASE_NOT_FOUND', 'FEE_MISMATCH', 'FEE_INCONSISTENT', 'SALE_TX_NOT_FOUND', 'ITEM_TRADE_LOCKED', 'WITHDRAWAL_FEE_ABOVE_AMOUNT']);
    expect(codes.size).toBeGreaterThan(5);
    for (const code of codes) {
      if (later.has(code)) continue;
      for (const lang of [ptBR, en]) {
        const reason = translate(lang as never, `imports.reasons.${code}`);
        const error = translate(lang as never, `errors.${code}`);
        const has = reason !== `imports.reasons.${code}` || error !== `errors.${code}`;
        expect({ code, has }).toEqual({ code, has: true });
      }
    }
  });

  test('avisos do lote, desfazer (bloqueios, avisos e motivos), grupos e códigos de erro da importação têm texto', () => {
    const needs = [
      'imports.warnings.SCAN_LIMIT_REACHED', 'imports.warnings.ORDER_NOT_GUARANTEED',
      'imports.undo.ITEM_EDITED', 'imports.undo.ITEM_IN_HOLDING', 'imports.undo.ITEM_SOLD_IN_APP',
      'imports.undo.reasons.NOT_LATEST', 'imports.undo.reasons.NOTHING_TO_UNDO', 'imports.undo.reasons.ALREADY_UNDONE', 'imports.undo.reasons.FAILED_BATCH',
      ...['CREATED', 'MATCHED', 'POSSIBLE_DUPLICATE', 'REVERTED', 'FAILED'].map((g) => `imports.groups.${g}`),
      ...['IMPORT_IN_PROGRESS', 'IMPORT_CUTOFF_REQUIRED', 'IMPORT_CUTOFF_ALREADY_SET', 'IMPORT_UNDO_NOT_LATEST', 'IMPORT_UNDO_CONFLICT',
        'IMPORT_UNDO_WARNINGS_NOT_CONFIRMED', 'IMPORT_BATCH_NOT_FOUND', 'CSFLOAT_ACCOUNT_CHANGED', 'IMPORT_STORE_REQUIRED',
        'IMPORT_STORE_CURRENCY_NOT_ALLOWED', 'IMPORT_SOURCE_UNREACHABLE', 'IMPORT_SOURCE_UNAVAILABLE', 'IMPORT_RATE_LIMITED',
        'IMPORT_SOURCE_FORMAT_CHANGED', 'CSFLOAT_AUTH_FAILED', 'CSFLOAT_API_KEY_REQUIRED', 'DATE_IN_FUTURE', 'INVALID_DATE', 'BACKUP_BUSY'].map((c) => `errors.${c}`),
    ];
    for (const key of needs) for (const lang of [ptBR, en]) expect({ key, text: translate(lang as never, key) }).not.toEqual({ key, text: key });
    // e a lista oficial de códigos da API conhece todos eles (o cliente trata por código)
    for (const code of ['IMPORT_IN_PROGRESS', 'IMPORT_CUTOFF_REQUIRED', 'IMPORT_UNDO_CONFLICT', 'IMPORT_UNDO_NOT_LATEST', 'CSFLOAT_ACCOUNT_CHANGED', 'IMPORT_BATCH_NOT_FOUND']) {
      expect(API_ERROR_CODES as readonly string[]).toContain(code);
    }
  });
});

// --- Invalidação -----------------------------------------------------------------------------------------------------------

describe('invalidação depois de importar e de desfazer', () => {
  const needs = [queryKeys.integrations.all, queryKeys.imports.all, queryKeys.items.all, queryKeys.sales.all, queryKeys.stores.all, queryKeys.storeBalances.all, queryKeys.profitSummary.all];
  test.each(['import.run', 'import.undo'] as const)('%s recarrega integração, lotes, itens, vendas, lojas, saldos e lucro real', (action) => {
    const map = INVALIDATION_MAP[action] as readonly (readonly unknown[])[];
    for (const key of needs) expect(map).toContainEqual(key);
  });

  test.each(['item.update', 'item.delete', 'item.unsell'] as const)('%s também invalida os lotes (desfazer e pendências dependem do item)', (action) => {
    expect(INVALIDATION_MAP[action] as readonly (readonly unknown[])[]).toContainEqual(queryKeys.imports.all);
  });

  test('o fluxo chama invalidate("import.run") com sucesso e com erro; o desfazer chama invalidate("import.undo")', () => {
    const hook = read('components', 'useCsfloatImport.tsx');
    expect(hook.match(/invalidate\('import\.run'\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(read('components', 'UndoImportDialog.tsx')).toContain("invalidate('import.undo')");
  });

  test('o hook consulta de novo a cada 2s enquanto importa (importInProgress) e para depois', () => {
    expect(read('components', 'useCsfloatImport.tsx')).toMatch(/refetchInterval[\s\S]*importInProgress[\s\S]*2000[\s\S]*false/);
  });
});

// --- Botão, estados e telas ------------------------------------------------------------------------------------------------

describe('botão "Importar do CSFloat"', () => {
  test('importDisabledReason: carregando, sem chave, sem loja, importando (local ou no backend) e liberado', () => {
    expect(importDisabledReason(null, false)).toBe('LOADING');
    expect(importDisabledReason({ ...baseView, hasApiKey: false }, false)).toBe('NO_KEY');
    expect(importDisabledReason({ ...baseView, storeId: null }, false)).toBe('NO_STORE');
    expect(importDisabledReason(baseView, true)).toBe('RUNNING');
    expect(importDisabledReason({ ...baseView, importInProgress: true }, false)).toBe('RUNNING');
    expect(importDisabledReason({ ...baseView, importInProgress: true, hasApiKey: false }, false)).toBe('RUNNING');
    expect(importDisabledReason(baseView, false)).toBeNull();
  });

  test('renderização: habilitado com chave; desabilitado e com dica sem chave, sem loja e durante a importação (pt-BR e en)', () => {
    const ok = render(createElement(ImportButton));
    expect(ok).toContain(translate(ptBR, 'imports.button'));
    expect(ok).not.toContain('disabled');
    // sem chave ou sem loja: vira "Importar automaticamente" (habilitado), que abre o modal com o caminho das configurações
    const noKey = render(createElement(ImportButton), { ...baseView, hasApiKey: false });
    expect(noKey).not.toContain('disabled');
    expect(noKey).toContain(translate(ptBR, 'csfloatSetup.button'));
    const noStore = render(createElement(ImportButton), { ...baseView, storeId: null }, 'en');
    expect(noStore).not.toContain('disabled');
    expect(noStore).toContain(translate(en, 'csfloatSetup.button'));
    const running = render(createElement(ImportButton), { ...baseView, importInProgress: true });
    expect(running).toContain('disabled');
    expect(running).toContain(translate(ptBR, 'imports.running'));
    expect(running).toContain('aria-busy');
    const loading = render(createElement(ImportButton), null);
    expect(loading).toContain('disabled');
  });

  test('o botão está no Inventário (antes de "Novo item") e em Vendas; o card usa o mesmo fluxo', () => {
    const inventory = read('app', 'page.tsx');
    const sales = read('app', 'sales', 'page.tsx');
    expect(inventory).toContain('<ImportButton />');
    expect(sales).toContain('<ImportButton />');
    expect(inventory.indexOf('<ImportButton />')).toBeLessThan(inventory.indexOf('newItem') === -1 ? Infinity : inventory.indexOf('newItem'));
    expect(read('components', 'CsfloatIntegrationCard.tsx')).toContain('useCsfloatImport');
  });

  test('o selo "CSFloat" aparece nas linhas do inventário e das vendas só para itens importados', () => {
    for (const file of ['InventoryUnitRow.tsx', 'SalesTable.tsx']) {
      expect(read('components', file)).toMatch(/externalSource === 'CSFLOAT'[\s\S]{0,80}<Badge tone="info" title=\{t\('imports\.badgeHint'\)\}>\{t\('imports\.badge'\)\}<\/Badge>/);
    }
    expect(translate(ptBR, 'imports.badge')).toBe('CSFloat');
    expect(translate(en, 'imports.badge')).toBe('CSFloat');
  });

  test('a página /imports existe fora do menu principal e é alcançável pelo resumo', () => {
    expect(fs.existsSync(path.join(SRC, 'app', 'imports', 'page.tsx'))).toBe(true);
    const menu = fs.readdirSync(path.join(SRC, 'components')).filter((f) => /Header|Nav|Menu/.test(f) && f.endsWith('.tsx')).map((f) => read('components', f)).join('\n');
    expect(menu).not.toMatch(/href=["'{]\/imports/);
    expect(read('components', 'ImportSummaryModal.tsx')).toContain('href="/imports/"');
  });
});

// --- Modal do corte --------------------------------------------------------------------------------------------------------

describe('modal da data de corte', () => {
  const noop = () => undefined;
  const modal = (suggested: string | null, lang: 'pt-BR' | 'en' = 'pt-BR', error: string | null = null) =>
    render(createElement(ImportCutoffModal, { suggestedCutoffAt: suggested, busy: false, error, onConfirm: noop, onCancel: noop }), baseView, lang);

  test('a sugestão vira o valor inicial do campo (editável); sem sugestão o campo vem vazio e há dica', () => {
    const withSuggestion = modal('2026-11-08T13:00:00.000Z');
    const value = suggestionToInputValue('2026-11-08T13:00:00.000Z');
    expect(value).toMatch(/^2026-11-0[78]T\d\d:\d\d$/);
    expect(withSuggestion).toContain(`value="${value}"`);
    expect(withSuggestion).not.toContain('readonly');
    expect(withSuggestion).not.toContain(translate(ptBR, 'imports.cutoff.noSuggestion'));
    const empty = modal(null);
    expect(empty).toContain('value=""');
    expect(empty).toContain(translate(ptBR, 'imports.cutoff.noSuggestion'));
  });

  test('pergunta e explicação do aporte-base em pt-BR e en; erro da importação aparece como alerta; campo limitado a agora', () => {
    const pt = modal(null, 'pt-BR', 'Falhou: tente de novo.');
    expect(pt).toContain(translate(ptBR, 'imports.cutoff.question'));
    expect(pt).toContain(translate(ptBR, 'imports.cutoff.baseDepositHint'));
    expect(pt).toContain('Falhou: tente de novo.');
    expect(pt).toContain('role="alert"');
    expect(pt).toMatch(/type="datetime-local"[^>]*max="\d{4}-\d\d-\d\dT\d\d:\d\d"|max="\d{4}-\d\d-\d\dT\d\d:\d\d"[^>]*type="datetime-local"/);
    expect(modal(null, 'en')).toContain(translate(en, 'imports.cutoff.question'));
  });

  test('validateCutoffInput: vazio, lixo, futuro, agora e passado', () => {
    const now = new Date('2026-11-22T15:00:00.000Z');
    expect(validateCutoffInput('', now)).toEqual({ ok: false, reason: 'EMPTY' });
    expect(validateCutoffInput('   ', now)).toEqual({ ok: false, reason: 'EMPTY' });
    expect(validateCutoffInput('amanhã', now)).toMatchObject({ ok: false });
    expect(validateCutoffInput('2999-01-01T00:00', now)).toEqual({ ok: false, reason: 'FUTURE' });
    expect(validateCutoffInput('2026-11-01T00:00', now)).toMatchObject({ ok: true });
    const ok = validateCutoffInput('2026-11-01T00:00', now);
    if (ok.ok) expect(Number.isNaN(Date.parse(ok.iso))).toBe(false); // ISO com fuso; o backend converte para UTC
  });
});

// --- Resumo ----------------------------------------------------------------------------------------------------------------

describe('modal de resumo e lista de entradas', () => {
  const summary = (b: ImportBatchView, lang: 'pt-BR' | 'en' = 'pt-BR') =>
    render(createElement(ImportSummaryModal, { batch: b, onClose: () => undefined }), baseView, lang);

  test('sem novidades: mostra "nada novo", sem lista de contagens vazia, sem "Desfazer" (lote sem mudanças) e com "Ver detalhes"', () => {
    const html = summary(batch({ counts: { ...ZERO, known: 12, beforeCutoff: 30 } }));
    expect(html).toContain(translate(ptBR, 'imports.summary.nothingNew'));
    expect(html).not.toContain(translate(ptBR, 'imports.undo.button'));
    expect(html).toContain(translate(ptBR, 'imports.summary.details'));
    expect(html).toContain('12 já importadas'.slice(0, 2));
    expect(isNothingNew({ ...ZERO, known: 12, beforeCutoff: 30 })).toBe(true);
  });

  test('com novidade: contagens em plural, aviso do lote traduzido, "Desfazer importação" só quando undoable', () => {
    const counts = { ...ZERO, purchasesCreated: 1, matched: 2, review: 1, failed: 3 };
    const html = summary(batch({ counts, undoable: true, warnings: ['SCAN_LIMIT_REACHED'], entries: [entry(1, 'CREATED', { entityType: 'ITEM_PURCHASE', entityId: 42 })] }));
    expect(html).toContain(translatePlural(ptBR, 'imports.counts.purchasesCreated', 1, 'pt-BR'));
    expect(html).toContain(translatePlural(ptBR, 'imports.counts.matched', 2, 'pt-BR'));
    expect(html).toContain(translate(ptBR, 'imports.warnings.SCAN_LIMIT_REACHED'));
    expect(html).toContain(translate(ptBR, 'imports.undo.button'));
    expect(html).not.toContain(translate(ptBR, 'imports.summary.nothingNew'));
    expect(summary(batch({ counts, undoable: false })).includes(translate(ptBR, 'imports.undo.button'))).toBe(false);
    const english = summary(batch({ counts, undoable: true, warnings: ['ORDER_NOT_GUARANTEED'] }), 'en');
    expect(english).toContain(translate(en, 'imports.warnings.ORDER_NOT_GUARANTEED'));
    expect(english).toContain(translate(en, 'imports.undo.button'));
  });

  test('aviso de lote desconhecido mostra o código em vez de quebrar', () => {
    expect(summary(batch({ counts: { ...ZERO, purchasesCreated: 1 }, warnings: ['NOVO_AVISO_X'] }))).toContain('NOVO_AVISO_X');
  });

  test('entradas: grupos na ordem (duplicado, revertido, falhas, criadas, ligadas), motivo traduzido, link do item e candidatos', () => {
    const entries = [
      entry(1, 'CREATED', { entityType: 'ITEM_PURCHASE', entityId: 42, reasonCode: 'PRICE_MISMATCH' }),
      entry(2, 'MATCHED', { entityType: 'ITEM_PURCHASE', entityId: 43 }),
      entry(3, 'POSSIBLE_DUPLICATE', { candidateIds: [5, 6] }),
      entry(4, 'REVERTED', { entityType: 'ITEM_PURCHASE', entityId: 44, reasonCode: 'REVERTED_PENDING_ACTION' }),
      entry(5, 'FAILED', { reasonCode: 'CATALOG_NOT_FOUND' }, { name: null, namePtBr: null, marketHashName: null, imageUrl: null, category: null }),
      entry(6, 'UNKNOWN_STATE', { reasonCode: 'UNKNOWN_STATE' }, { state: 'weird_state' }),
    ];
    expect(groupEntries(entries).map((g) => g.key)).toEqual(['POSSIBLE_DUPLICATE', 'REVERTED', 'FAILED', 'CREATED', 'MATCHED']);
    const html = render(createElement(ImportEntriesList, { entries }));
    for (const key of ['POSSIBLE_DUPLICATE', 'REVERTED', 'FAILED', 'CREATED', 'MATCHED']) expect(html).toContain(translate(ptBR, `imports.groups.${key}`));
    expect(html).toContain('href="/?item=42"');
    expect(html).toContain('href="/?item=43"');
    expect(html).toContain('href="/?item=5"');
    expect(html).toContain('href="/?item=6"');
    expect(html).toContain(translate(ptBR, 'imports.reasons.PRICE_MISMATCH'));
    expect(html).toContain(translate(ptBR, 'imports.reasons.CATALOG_NOT_FOUND'));
    expect(html).toContain('weird_state'); // {state} do UNKNOWN_STATE
    expect(html).toContain(translate(ptBR, 'imports.unknownItem')); // sem nome no catálogo nem no trade
  });

  test('entradas sem dados da contraparte: nada de comprador, vendedor, URL ou token na marcação', () => {
    const html = render(createElement(ImportEntriesList, { entries: [entry(1, 'CREATED', { entityType: 'ITEM_PURCHASE', entityId: 1 })] }));
    for (const secret of ['steamcommunity', 'trade_token', 'steam://', '7656119']) expect(html).not.toContain(secret);
    expect(html).toContain('float');
    expect(html).toContain('seed 661');
  });

  test('lista vazia não renderiza nada', () => {
    expect(render(createElement(ImportEntriesList, { entries: [] }))).toBe('');
  });
});

// --- Funções puras ---------------------------------------------------------------------------------------------------------

describe('importSummary: bordas', () => {
  test('summaryLines respeita a ordem fixa mesmo com todas as contagens e ignora as zeradas', () => {
    const all = Object.fromEntries(COUNT_LINES.map((k) => [k, 1])) as unknown as ImportBatchCounts;
    expect(summaryLines({ ...ZERO, ...all }).map((l) => l.key)).toEqual([...COUNT_LINES]);
  });
  test('"nada novo" considera a venda criada e as pendências como novidade', () => {
    expect(isNothingNew({ ...ZERO, salesCreated: 1 })).toBe(false);
    expect(isNothingNew({ ...ZERO, unknownState: 1 })).toBe(false);
    expect(isNothingNew({ ...ZERO, deferredSales: 50, notTransferred: 4 })).toBe(true);
  });
});
