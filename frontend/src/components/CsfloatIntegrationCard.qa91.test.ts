import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate } from '@/i18n/translate';

// QA 9.1 (reescrito na 12.9): o card do CSFloat agora é testado por comportamento em CsfloatIntegrationCard.test.tsx (jsdom). Aqui
// ficam só a análise do código-fonte para o que não aparece na tela (a chave fora do cache, invalidações) e a i18n.
describe('o que depende de clique (análise do código-fonte)', () => {
  const source = fs.readFileSync(path.join(__dirname, 'CsfloatIntegrationCard.tsx'), 'utf8');

  test('mostrar/esconder alterna o type entre text e password, começa escondido e usa um botão com aria-pressed', () => {
    expect(source).toContain("const [showKey, setShowKey] = useState(false)");
    expect(source).toContain("type={showKey ? 'text' : 'password'}");
    expect(source).toContain("pressed={showKey}");
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
    expect(source).toContain("'settings.integrations.csfloat.keyTooShort'");
    expect(source).toMatch(/errorMessageFor\(error, tLoose, locale\)/);
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
    expect(source).toMatch(/feeUpdateBody !== null && integration.storeId !== null/);
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
      'switchConfirmBody', 'switched', 'help', 'privacy', 'linkedStore', 'noStore', 'removeConfirmTitle', 'removeConfirmBody',
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
    // 9.5: o PATCH da integração volta ao card só para a opção "Importar ao abrir o app" e "Reativar", nunca para a loja.
    expect(card).not.toMatch(/listStores|<select|storeId:/);
  });

  test('as chaves removidas não existem mais nos dois idiomas', () => {
    for (const key of ['store', 'storeHint', 'storeNone', 'storeSaved']) {
      expect(translate(ptBR, `settings.integrations.csfloat.${key}`)).toBe(`settings.integrations.csfloat.${key}`);
      expect(translate(en, `settings.integrations.csfloat.${key}`)).toBe(`settings.integrations.csfloat.${key}`);
    }
  });
});
