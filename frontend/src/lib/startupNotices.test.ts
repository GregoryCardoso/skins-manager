// Revisão da Etapa 9 e pedidos do usuário: aviso "sem conexão" ao abrir, "nada novo", aportes/saques no aviso e o botão
// "Importar automaticamente" com o passo a passo nas configurações.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import ptBR from '@/i18n/pt-BR.json';
import en from '@/i18n/en.json';
import { autoImportNotice } from './autoImport';
import { isOfflineFailure, offlineTasks } from './startupStatus';
import type { ImportBatchView } from '@/types/api';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const batch = (counts: Partial<ImportBatchView['counts']>) =>
  ({ counts: { purchasesCreated: 0, salesCreated: 0, matched: 0, ...counts } }) as unknown as ImportBatchView;

test('sem conexão: só os códigos de "não deu para falar com a fonte" ou o sistema sem rede', () => {
  expect(isOfflineFailure('FX_FETCH_FAILED')).toBe(true);
  expect(isOfflineFailure('IMPORT_SOURCE_UNREACHABLE')).toBe(true);
  expect(isOfflineFailure('CSFLOAT_AUTH_FAILED')).toBe(false);
  expect(isOfflineFailure('CSFLOAT_AUTH_FAILED', false)).toBe(true);
  expect(isOfflineFailure(null)).toBe(false);
  expect(offlineTasks({ fx: 'OFFLINE', csfloat: 'OFFLINE' })).toEqual(['fx', 'csfloat']);
  expect(offlineTasks({ fx: 'OK', csfloat: 'OFFLINE' })).toEqual(['csfloat']);
  expect(offlineTasks({})).toEqual([]);
});

test('aviso da importação ao abrir: nada novo, aportes/saques e trades', () => {
  expect(autoImportNotice(null)).toEqual({ kind: 'NOTHING_NEW' });
  expect(autoImportNotice(batch({ depositsCreated: 1, withdrawalsCreated: 1 }))).toEqual({ kind: 'TRANSFERS', count: 2 });
  expect(autoImportNotice(batch({ purchasesCreated: 2, depositsCreated: 1 }))).toEqual({ kind: 'CREATED', count: 2 });
  expect(autoImportNotice(batch({}))).toEqual({ kind: 'ATTENTION' });
});

test('as duas buscas correm juntas, e o modal "sem conexão" fica no layout', () => {
  const layout = read('app/layout.tsx');
  expect(layout).toMatch(/<CsfloatAutoImportHost \/>/);
  expect(layout).toMatch(/<FxAutoRefreshHost \/>/);
  expect(layout).toMatch(/<StartupOfflineModal \/>/);
  expect(read('components/CsfloatAutoImportHost.tsx')).toMatch(/reportStartup\('csfloat', 'OFFLINE'\)/);
  expect(read('components/FxAutoRefreshHost.tsx')).toMatch(/reportStartup\('fx', 'OFFLINE'\)/);
});

test('"Importar automaticamente" nos lugares de lançar e o passo a passo nas configurações', () => {
  expect(read('components/ImportButton.tsx')).toMatch(/ImportSetupModal/);
  expect(read('app/profit/page.tsx')).toMatch(/<ImportButton \/>/);
  expect(read('components/WithdrawalsSection.tsx')).toMatch(/<ImportButton \/>/);
  expect(read('components/ImportSetupModal.tsx')).toMatch(/\/settings\/#csfloat/);
  expect(read('components/CsfloatIntegrationCard.tsx')).toMatch(/!integration\.hasApiKey && <CsfloatSetupGuide \/>/);
  for (const lang of [ptBR, en]) {
    for (const key of ['button', 'modalTitle', 'configure', 'step1', 'step5', 'open', 'safety'] as const) expect(lang.csfloatSetup[key]).toBeTruthy();
    for (const key of ['title', 'intro', 'fx', 'csfloat', 'hint', 'ok'] as const) expect(lang.startup.offline[key]).toBeTruthy();
    expect(lang.imports.auto.nothingNew).toBeTruthy();
  }
  expect(ptBR.csfloatSetup.step2).toMatch(/Developers/);
});
