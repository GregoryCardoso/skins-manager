import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate } from '@/i18n/translate';

// QA 9.1 (12.9; S4 da 12.11): o comportamento do card está em CsfloatIntegrationCard.test.tsx e CsfloatIntegrationCard.s4.test.tsx (jsdom).
// Aqui ficam só a varredura de i18n e a lista de integrações implementadas.
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

  test('as chaves removidas não existem mais nos dois idiomas', () => {
    for (const key of ['store', 'storeHint', 'storeNone', 'storeSaved']) {
      expect(translate(ptBR, `settings.integrations.csfloat.${key}`)).toBe(`settings.integrations.csfloat.${key}`);
      expect(translate(en, `settings.integrations.csfloat.${key}`)).toBe(`settings.integrations.csfloat.${key}`);
    }
  });
});
