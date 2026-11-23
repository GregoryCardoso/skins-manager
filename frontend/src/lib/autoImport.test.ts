// 9.5 (D303): quando a importação ao abrir dispara, o aviso discreto e o motivo da pausa.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import ptBR from '@/i18n/pt-BR.json';
import en from '@/i18n/en.json';
import type { ImportBatchView, IntegrationView } from '@/types/api';
import { autoImportNotice, pausedReason, shouldRunAutoImport } from './autoImport';

const base = {
  autoImportOnOpen: true, autoImportPaused: false, hasApiKey: true, storeId: 1, tradesCutoffAt: '2026-11-01T00:00:00.000Z',
  importInProgress: false, lastUndoneAt: null,
} as unknown as IntegrationView;
const batch = (counts: Partial<ImportBatchView['counts']>) => ({
  counts: { purchasesCreated: 0, salesCreated: 0, matched: 0, review: 0, reverted: 0, failed: 0, unknownState: 0, ...counts },
}) as unknown as ImportBatchView;

describe('shouldRunAutoImport', () => {
  test('só com a opção ligada, chave, loja, corte, sem pausa e sem importação em curso', () => {
    expect(shouldRunAutoImport(base)).toBe(true);
    expect(shouldRunAutoImport(null)).toBe(false);
    for (const change of [
      { autoImportOnOpen: false }, { autoImportPaused: true }, { hasApiKey: false }, { storeId: null }, { tradesCutoffAt: null }, { importInProgress: true },
    ]) {
      expect(shouldRunAutoImport({ ...base, ...change } as IntegrationView)).toBe(false);
    }
  });
});

describe('autoImportNotice', () => {
  test('nada novo: aviso curto; criados: compras + vendas; senão ligados; senão pendências', () => {
    expect(autoImportNotice(null)).toEqual({ kind: 'NOTHING_NEW' });
    expect(autoImportNotice(batch({ purchasesCreated: 2, salesCreated: 1 }))).toEqual({ kind: 'CREATED', count: 3 });
    expect(autoImportNotice(batch({ matched: 2 }))).toEqual({ kind: 'MATCHED', count: 2 });
    expect(autoImportNotice(batch({ reverted: 1 }))).toEqual({ kind: 'ATTENTION' });
  });
  test('textos nos dois idiomas, com o exemplo do pedido', () => {
    expect(ptBR.imports.auto.created.other.replace('{count}', '3')).toBe('3 trades importados do CSFloat');
    for (const lang of [ptBR, en]) {
      for (const key of ['attention', 'failed', 'seeSummary'] as const) expect(lang.imports.auto[key]).toBeTruthy();
    }
  });
});

describe('pausa', () => {
  test('desfazer (com a data) ou troca de conta; sem pausa, nada', () => {
    expect(pausedReason(base)).toBeNull();
    expect(pausedReason({ ...base, autoImportPaused: true, lastUndoneAt: '2026-11-22T15:00:00.000Z' } as IntegrationView))
      .toEqual({ kind: 'UNDO', at: '2026-11-22T15:00:00.000Z' });
    expect(pausedReason({ ...base, autoImportPaused: true } as IntegrationView)).toEqual({ kind: 'ACCOUNT_SWITCH' });
    for (const lang of [ptBR, en]) {
      const card = lang.settings.integrations.csfloat as unknown as Record<string, string>;
      for (const key of ['autoImport', 'autoImportHint', 'autoPausedUndo', 'autoPausedSwitch', 'autoResume']) expect(card[key]).toBeTruthy();
    }
  });
});

test('o host está montado no layout (vale no desktop e no start-app.bat)', () => {
  const layout = fs.readFileSync(path.join(__dirname, '..', 'app', 'layout.tsx'), 'utf8');
  expect(layout).toMatch(/<CsfloatAutoImportHost \/>/);
  const host = fs.readFileSync(path.join(__dirname, '..', 'components', 'CsfloatAutoImportHost.tsx'), 'utf8');
  expect(host).toMatch(/trigger: 'AUTO'/);
});
