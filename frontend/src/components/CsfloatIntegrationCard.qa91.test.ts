import fs from 'node:fs';
import path from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate, translatePlural } from '@/i18n/translate';
import { queryKeys } from '@/lib/queryKeys';
import type { IntegrationView, Store } from '@/types/api';

// QA 9.1: card do CSFloat. Sem jsdom: renderização estática com os dados já no cache (estados) + análise do código-fonte
// para o que depende de clique (mostrar/esconder, limpar o campo, chave fora do cache) + i18n e cliente da API.
const LANG = { current: 'pt-BR' as 'pt-BR' | 'en' };
const dict = () => (LANG.current === 'en' ? en : ptBR);
vi.mock('@/i18n/I18nProvider', () => {
  const t = (key: string, params?: Record<string, string | number>) => translate(dict(), key, params);
  const tPlural = (key: string, count: number, params?: Record<string, string | number>) => translatePlural(dict(), key, count, LANG.current, params);
  return { useT: () => t, useTLoose: () => t, useTPlural: () => tPlural, useLanguage: () => LANG.current };
});

import CsfloatIntegrationCard from './CsfloatIntegrationCard';

// Dados INVENTADOS.
const baseView: IntegrationView = {
  source: 'CSFLOAT', storeId: 1, storeName: 'CSFloat', storeCurrency: 'USD', storeSaleFeeRate: 0.02, storeWithdrawalFeeRate: 0.025,
  hasApiKey: false, apiKeyMasked: null, apiKeySavedAt: null, accountLinked: false, autoImportOnOpen: false, autoImportPaused: false,
  tradesCutoffAt: null, transactionsCutoffAt: null, lastImportAt: null, lastImportStatus: null, lastImportErrorCode: null,
  importInProgress: false, openEntriesCount: 0, suggestedCutoffAt: null, helpUrl: 'https://csfloat.com/profile',
};
const stores = [
  { id: 1, name: 'CSFloat', currency: 'USD' },
  { id: 2, name: 'Steam', currency: 'BRL' },
  { id: 3, name: 'CSMoney', currency: 'USD' },
] as unknown as Store[];

function render(view: IntegrationView | null, language: 'pt-BR' | 'en' = 'pt-BR') {
  LANG.current = language;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (view) client.setQueryData(queryKeys.integrations.csfloat, view);
  client.setQueryData(queryKeys.stores.all, stores);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(CsfloatIntegrationCard)));
}

describe('estados do card (renderização)', () => {
  test('carregando: mostra "Carregando" e nenhum formulário', () => {
    const html = render(null);
    expect(html).toContain(translate(ptBR, 'common.loading'));
    expect(html).not.toContain('<form');
  });

  test('sem chave: "Nenhuma chave salva.", campo de senha vazio, "Salvar chave" e "Testar conexão" desabilitado, sem "Remover"', () => {
    const html = render(baseView);
    expect(html).toContain('Nenhuma chave salva.');
    expect(html).toMatch(/<input[^>]*type="password"/);
    expect(html).toContain('Salvar chave');
    expect(html).not.toContain('Trocar chave');
    expect(html).not.toContain('Remover chave');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Testar conexão<\/button>/);
  });

  test('com chave: mostra só a máscara, "Trocar chave", "Remover chave" e "Testar conexão" habilitado', () => {
    const html = render({ ...baseView, hasApiKey: true, apiKeyMasked: '••••••••a1b2' });
    expect(html).toContain('Chave salva: ••••••••a1b2');
    expect(html).toContain('Trocar chave');
    expect(html).toContain('Remover chave');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Testar conexão<\/button>/);
    // o campo nasce vazio e escondido: a chave nunca é preenchida de volta
    expect(html).toMatch(/<input[^>]*type="password"[^>]*value=""/);
    expect(html).toContain('autoComplete="off"');
  });

  test('o botão de mostrar começa como "Mostrar" (aria-pressed false)', () => {
    const html = render(baseView);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Mostrar<\/button>|<button[^>]*aria-pressed="false"[^>]*>Mostrar/);
  });

  test('não lista outras lojas: sem seletor, e os nomes das outras lojas do cache não aparecem (D317)', () => {
    const html = render(baseView);
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<option');
    expect(html).not.toContain('Steam');
    expect(html).not.toContain('CSMoney');
    expect(html).toContain('Lançamentos vão para a loja: CSFloat');
  });

  test('loja renomeada: mostra o nome atual da loja vinculada', () => {
    expect(render({ ...baseView, storeName: 'Minha CSFloat' })).toContain('Lançamentos vão para a loja: Minha CSFloat');
  });

  test('sem loja vinculada: aviso curto traduzido pedindo para criar a loja "CSFloat" em US$', () => {
    const html = render({ ...baseView, storeId: null, storeName: null, storeCurrency: null });
    expect(html).toContain('A loja CSFloat não foi encontrada');
    expect(html).toContain('chamada &quot;CSFloat&quot;');
    expect(html).not.toContain('Lançamentos vão para a loja');
    expect(render({ ...baseView, storeId: null, storeName: null, storeCurrency: null }, 'en')).toContain('The CSFloat store was not found');
  });

  test('link de ajuda abre em nova aba com rel seguro; URL que não é https vira texto simples', () => {
    const ok = render(baseView);
    expect(ok).toMatch(/<a[^>]*href="https:\/\/csfloat\.com\/profile"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
    const bad = render({ ...baseView, helpUrl: 'javascript:alert(1)' });
    expect(bad).not.toContain('javascript:');
    expect(bad).not.toContain('<a ');
    expect(bad).toContain('Onde gerar a chave?');
  });

  test('mostra o aviso de privacidade (chave fora dos backups e dos registros)', () => {
    expect(render(baseView)).toContain('não vai para os backups');
    expect(render(baseView, 'en')).toContain('not included in backups');
  });

  test('em inglês os rótulos mudam', () => {
    const html = render({ ...baseView, hasApiKey: true, apiKeyMasked: '••••••••a1b2' }, 'en');
    expect(html).toContain('Saved key: ••••••••a1b2');
    expect(html).toContain('Test connection');
    expect(html).toContain('Remove key');
  });
});

describe('o que depende de clique (análise do código-fonte)', () => {
  const source = fs.readFileSync(path.join(__dirname, 'CsfloatIntegrationCard.tsx'), 'utf8');

  test('mostrar/esconder alterna o type entre text e password e começa escondido', () => {
    expect(source).toMatch(/const \[showKey, setShowKey\] = useState\(false\)/);
    expect(source).toMatch(/type=\{showKey \? 'text' : 'password'\}/);
    expect(source).toMatch(/aria-pressed=\{showKey\}/);
  });

  test('depois de salvar o campo é limpo e escondido; a chave nunca entra no cache de consultas nem no console', () => {
    expect(source).toMatch(/setKeyText\(''\)[\s\S]{0,80}setShowKey\(false\)/);
    expect(source).not.toMatch(/setQueryData|localStorage|sessionStorage|console\./);
    expect(source).not.toMatch(/keyText\b[^;\n]*(JSON|queryKey|set\w*Query)/);
  });

  test('o campo evita autocompletar, correção e checagem ortográfica', () => {
    for (const attr of ['autoComplete="off"', 'autoCorrect="off"', 'autoCapitalize="off"', 'spellCheck={false}']) expect(source).toContain(attr);
  });

  test('validação do formato antes de enviar (mesma regra do backend) e erros via errorMessageFor com o código', () => {
    expect(source).toMatch(/validateApiKeyInput\(keyText\)/);
    expect(source).toContain("'errors.INVALID_API_KEY_FORMAT'");
    expect(source).toMatch(/errorMessageFor\(error, tLoose, language\)/);
  });

  test('remover e trocar de conta exigem confirmação (diálogo) e a atualização de taxas da loja também', () => {
    for (const dlg of ["'remove'", "'switch'", "'updateStore'"]) expect(source).toContain(`setDialog(${dlg})`);
    expect(source).toMatch(/dialog === 'remove'[\s\S]*ConfirmDialog/);
  });

  test('cada ação invalida as consultas certas (integration.* e store.update)', () => {
    for (const action of ['integration.apiKey', 'integration.test', 'integration.switchAccount', 'store.update']) {
      expect(source).toContain(`invalidate('${action}')`);
    }
  });

  test('o teste mostra "Conectado como" só com o nome vindo da resposta (nunca gravado) e o aviso de conta diferente', () => {
    expect(source).toContain("'settings.integrations.csfloat.connectedAs'");
    expect(source).toContain("'settings.integrations.csfloat.connectedNoName'");
    expect(source).toMatch(/!testResult\.accountMatches/);
    expect(source).not.toMatch(/username[^\n]*(localStorage|setQueryData)/);
  });

  test('o botão "Atualizar a loja" só aparece com aviso de taxa, corpo a enviar e loja definida', () => {
    expect(source).toMatch(/warnings\.length > 0 && feeUpdateBody !== null && integration\.storeId !== null/);
  });
});

describe('i18n do card e das integrações', () => {
  const sources = ['CsfloatIntegrationCard.tsx', 'IntegrationsSettings.tsx'].map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
  const keys = [...new Set([...sources.matchAll(/\bt\('([\w.]+)'/g)].map((m) => m[1]))];
  const holders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

  test('a extração encontrou as chaves literais', () => {
    expect(keys.length).toBeGreaterThan(25);
  });
  test.each(keys)('chave %s existe em pt-BR e en com os mesmos {marcadores}', (key) => {
    const pt = translate(ptBR, key);
    const enText = translate(en, key);
    expect(pt, `pt-BR ${key}`).not.toBe(key);
    expect(enText, `en ${key}`).not.toBe(key);
    expect(holders(enText)).toEqual(holders(pt));
  });
  test('chaves do aviso de taxa e de atualização da loja existem nos dois idiomas', () => {
    for (const key of [
      'saleFeeMismatch', 'withdrawalFeeMismatch', 'updateStore', 'updateStoreConfirm', 'accountMismatch', 'switchAccount', 'switchConfirmTitle',
      'switchConfirmBody', 'switched', 'help', 'helpText', 'privacy', 'linkedStore', 'noStore', 'removeConfirmTitle', 'removeConfirmBody',
    ]) {
      expect(translate(ptBR, `settings.integrations.csfloat.${key}`)).not.toBe(`settings.integrations.csfloat.${key}`);
      expect(translate(en, `settings.integrations.csfloat.${key}`)).not.toBe(`settings.integrations.csfloat.${key}`);
    }
  });
  test('os textos não deixam o mesmo idioma nos dois arquivos (en é mesmo inglês)', () => {
    expect(translate(en, 'settings.integrations.csfloat.test')).toBe('Test connection');
    expect(translate(ptBR, 'settings.integrations.csfloat.test')).toBe('Testar conexão');
  });
});

describe('seção Integrações (D317)', () => {
  const settingsSource = fs.readFileSync(path.join(__dirname, 'IntegrationsSettings.tsx'), 'utf8');

  test('só integrações com Adapter implementado: hoje apenas CSFLOAT, sem "em breve" nem outras lojas', () => {
    expect(settingsSource).toMatch(/IMPLEMENTED_INTEGRATIONS[^=]*=\s*\[\s*\{ source: 'CSFLOAT', Card: CsfloatIntegrationCard \},\s*\]/);
    expect(settingsSource).not.toMatch(/Steam|CSMoney|CS\.MONEY|em breve|coming soon/i);
  });

  test('o card não usa mais o seletor de loja nem a lista de lojas', () => {
    const card = fs.readFileSync(path.join(__dirname, 'CsfloatIntegrationCard.tsx'), 'utf8');
    expect(card).not.toMatch(/listStores|<select|updateCsfloatIntegration/);
  });

  test('as chaves removidas não existem mais nos dois idiomas', () => {
    for (const key of ['store', 'storeHint', 'storeNone', 'storeSaved']) {
      expect(translate(ptBR, `settings.integrations.csfloat.${key}`)).toBe(`settings.integrations.csfloat.${key}`);
      expect(translate(en, `settings.integrations.csfloat.${key}`)).toBe(`settings.integrations.csfloat.${key}`);
    }
  });
});
