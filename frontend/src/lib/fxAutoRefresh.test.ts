// D338: atualização da cotação ao abrir o app e o aviso nas configurações.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import ptBR from '@/i18n/pt-BR.json';
import en from '@/i18n/en.json';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('o host fica no layout (desktop e start-app.bat), pede o modo AUTO e não chama nada com a cotação manual', () => {
  expect(read('app/layout.tsx')).toMatch(/<FxAutoRefreshHost \/>/);
  const host = read('components/FxAutoRefreshHost.tsx');
  // 11.3: percorre, em série, todas as moedas necessárias (sem as digitadas à mão, que `currenciesToAutoRefresh` tira da lista).
  expect(host).toMatch(/refreshFxRate\(\{ currency, trigger: 'AUTO' \}\)/);
  expect(host).toMatch(/currenciesToAutoRefresh\(settings\.requiredFxCurrencies, settings\.fxRates\)/);
  expect(host).toMatch(/for \(const currency of currencies\)/);
  expect(host).toMatch(/invalidate\('settings\.fx'\)/);
});

test('as configurações avisam que a fonte automática atualiza ao abrir (e que a manual não)', () => {
  const settings = read('components/FxRateSettings.tsx');
  expect(settings).toMatch(/settings\.fx\.autoRefreshHint/);
  expect(settings).toMatch(/settings\.fx\.autoRefreshPausedManual/);
  for (const lang of [ptBR, en]) {
    for (const key of ['autoRefreshHint', 'autoRefreshPausedManual', 'autoFailed', 'autoFailedWithRate'] as const) {
      expect(lang.settings.fx[key]).toBeTruthy();
    }
  }
  expect(ptBR.settings.fx.autoRefreshHint).toMatch(/atualizada sozinha sempre que o app é aberto/);
});
