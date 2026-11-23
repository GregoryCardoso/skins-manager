// 9.5.1c (D324, D325): confirmação da varredura completa, mudança da data de corte e textos.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import ptBR from '@/i18n/pt-BR.json';
import en from '@/i18n/en.json';
import { INVALIDATION_MAP } from './queryInvalidation';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('a varredura completa pede confirmação, explicando que o corte continua valendo', () => {
  const hook = read('components/useCsfloatImport.tsx');
  expect(hook).toMatch(/setConfirmFullScan\(true\)/);
  expect(ptBR.imports.fullScanConfirm.body).toContain('{date}');
  expect(ptBR.imports.fullScanConfirm.body).toMatch(/continuam de fora/);
  expect(en.imports.fullScanConfirm.body).toContain('{date}');
});

test('a data de corte é editável na página Importações, com o mesmo fluxo do card', () => {
  const page = read('app/imports/page.tsx');
  expect(page).toMatch(/importer\.openCutoffChange/);
  expect(page).toMatch(/importer\.dialogs/);
  expect(INVALIDATION_MAP['import.changeCutoff']).toEqual(INVALIDATION_MAP['import.run']);
});

test('textos da mudança de corte nos dois idiomas', () => {
  for (const lang of [ptBR, en]) {
    const c = lang.imports.cutoffChange as Record<string, unknown>;
    for (const key of ['blockTitle', 'blockBody', 'backwardHelp', 'forwardHelp', 'undoHelp', 'upToPurchases', 'upToSales', 'mayHaveUnseen', 'importedKept', 'openToClose', 'history']) {
      expect(c[key]).toBeTruthy();
    }
    expect((lang.errors as Record<string, string>).IMPORT_CUTOFF_UNCHANGED).toBeTruthy();
    expect((lang.errors as Record<string, string>).IMPORT_CUTOFF_NOT_SET).toBeTruthy();
  }
});
