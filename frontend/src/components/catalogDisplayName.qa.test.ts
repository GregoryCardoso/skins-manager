import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, test } from 'vitest';
import { invalidateAfter } from '@/lib/queryInvalidation';
import { queryKeys } from '@/lib/queryKeys';
import { catalogDisplayName } from './CatalogAutocomplete';

// QA 11.5 (D369): bordas do nome exibido, ausência de restos do nome pt-BR fixo e a invalidação da troca de idioma.

describe('catalogDisplayName (bordas)', () => {
  const base = { name: 'AK-47 | Redline' };

  test('localizedName ausente (undefined), nulo ou vazio cai no inglês; só espaços também', () => {
    expect(catalogDisplayName(base as Parameters<typeof catalogDisplayName>[0])).toBe('AK-47 | Redline');
    expect(catalogDisplayName({ ...base, localizedName: null })).toBe('AK-47 | Redline');
    expect(catalogDisplayName({ ...base, localizedName: '' })).toBe('AK-47 | Redline');
    expect(catalogDisplayName({ ...base, localizedName: '   ' })).toBe('AK-47 | Redline');
  });

  test('nome em chinês e o canônico em inglês não é alterado', () => {
    const item = { ...base, localizedName: 'AK-47 | 红线' };
    expect(catalogDisplayName(item)).toBe('AK-47 | 红线');
    expect(item.name).toBe('AK-47 | Redline');
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) && entry !== 'testFixtures.ts' ? [full] : [];
  });
}

describe('sem restos do nome pt-BR fixo', () => {
  const files = sourceFiles(path.join(process.cwd(), 'src'));

  test('nenhum código de produção usa namePtBr', () => {
    const offenders = files.filter((f) => /namePtBr/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  test('nenhum componente decide o nome do item comparando o idioma com pt-BR', () => {
    const offenders = files.filter((f) => /language\s*[!=]==?\s*['"]pt-BR['"]|['"]pt-BR['"]\s*[!=]==?\s*language/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  test('a troca de idioma na PreferencesProvider usa a ação settings.language', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/PreferencesProvider.tsx'), 'utf8');
    expect(source).toMatch(/patch\.language !== undefined \? 'settings\.language' : 'settings\.preferences'/);
  });
});

describe('settings.language', () => {
  const populated = () => {
    const client = new QueryClient();
    const keys = [
      queryKeys.items.list({}), queryKeys.sales.list({}), queryKeys.imports.batches, queryKeys.marketValues.summary, queryKeys.catalog.status,
      queryKeys.settings.all, queryKeys.stores.all, queryKeys.deposits.all, queryKeys.withdrawals.all, queryKeys.profitSummary.all, queryKeys.health.all,
    ];
    for (const key of keys) client.setQueryData(key, { ok: true });
    return { client, keys };
  };
  const invalidated = (client: QueryClient, keys: Array<readonly unknown[]>) => keys.filter((k) => client.getQueryState(k)?.isInvalidated).map((k) => String(k[0]));

  test('invalida o que mostra nome de item e nada de dinheiro puro; o tema não invalida itens', () => {
    const { client, keys } = populated();
    invalidateAfter(client, 'settings.language');
    expect(invalidated(client, keys).sort()).toEqual(['catalog', 'imports', 'items', 'marketValues', 'sales', 'settings']);
    const other = populated();
    invalidateAfter(other.client, 'settings.preferences');
    expect(invalidated(other.client, other.keys)).toEqual(['settings']);
  });
});
