import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import ru from '@/i18n/ru.json';
import pl from '@/i18n/pl.json';
import { translate, translatePlural } from '@/i18n/translate';
import type { CatalogStatus, FxRateEntry, Settings } from '@/types/api';
import { sectionFromHash, settingsStatuses, SETTINGS_SECTIONS, type SettingsStatusInput } from './settingsStatus';

const NOW = new Date('2026-11-27T12:00:00.000Z');
const DAY = 86_400_000;

const rate = (currency: string, ageDays: number, extra: Partial<FxRateEntry> = {}): FxRateEntry => ({
  currency, rate: 5, source: 'AWESOMEAPI', refreshSource: 'AWESOMEAPI',
  quotedAt: new Date(NOW.getTime() - ageDays * DAY).toISOString(), updatedAt: NOW.toISOString(), ...extra,
});

const settings = (extra: Partial<Settings> = {}): Settings => ({
  displayCurrency: 'BRL', fxRates: [rate('BRL', 0)], requiredFxCurrencies: ['BRL'], catalogUpdatedAt: null, steamStoreId: null,
  theme: 'DARK', language: 'pt-BR', inventoryView: 'GROUPED', fastTurnoverDaysCustom: null, slowItemDaysCustom: null,
  fastTurnoverDays: 7, slowItemDays: 21, fastTurnoverDaysDefault: 7, slowItemDaysDefault: 21, agingThresholdsAdjusted: false,
  updatedAt: NOW.toISOString(), ...extra,
} as Settings);

function input(dict: object, locale: string, extra: Partial<SettingsStatusInput> = {}): SettingsStatusInput {
  return {
    t: (key, params) => translate(dict, key, params),
    tPlural: (key, count, params) => translatePlural(dict, key, count, locale, params),
    locale, now: NOW, theme: 'DARK', language: 'pt-BR', settings: settings(), csfloat: null, catalog: null, version: null, backupFolderReady: false,
    ...extra,
  };
}

describe('settingsStatuses', () => {
  test('Preferências: tema, idioma (nome nativo) e moeda', () => {
    expect(settingsStatuses(input(ptBR, 'pt-BR')).preferences).toBe('Escuro · Português (Brasil) · R$');
  });

  test('Cotações: uma moeda em dia; com uma antiga, conta as antigas', () => {
    expect(settingsStatuses(input(ptBR, 'pt-BR')).fx).toBe('1 moeda');
    const stale = settings({ requiredFxCurrencies: ['BRL', 'EUR', 'UAH'], fxRates: [rate('BRL', 0), rate('EUR', 0), rate('UAH', 9)] });
    expect(settingsStatuses(input(ptBR, 'pt-BR', { settings: stale })).fx).toBe('3 moedas · 1 antiga');
  });

  test('Cotações: falta a cotação de uma moeda necessária; nenhuma necessária = sem estado', () => {
    const missing = settings({ requiredFxCurrencies: ['BRL', 'EUR'], fxRates: [rate('BRL', 0)] });
    expect(settingsStatuses(input(en, 'en', { settings: missing })).fx).toBe('EUR rate missing');
    expect(settingsStatuses(input(en, 'en', { settings: settings({ requiredFxCurrencies: [], fxRates: [] }) })).fx).toBeNull();
  });

  test('Giro: limites em dias abreviados', () => {
    expect(settingsStatuses(input(en, 'en')).aging).toBe('Fast up to 7 d · stuck above 21 d');
    expect(settingsStatuses(input(ru, 'ru')).aging).toBe('Быстрый оборот до 7 дн. · залежался после 21 дн.');
  });

  test('Integrações: sem chave, conectado e conectado com pendências (plural)', () => {
    expect(settingsStatuses(input(en, 'en', { csfloat: { hasApiKey: false, openEntriesCount: 0 } })).integrations).toBe('CSFloat: no key');
    expect(settingsStatuses(input(en, 'en', { csfloat: { hasApiKey: true, openEntriesCount: 0 } })).integrations).toBe('CSFloat connected');
    expect(settingsStatuses(input(en, 'en', { csfloat: { hasApiKey: true, openEntriesCount: 2 } })).integrations).toBe('CSFloat connected · 2 to review');
    expect(settingsStatuses(input(pl, 'pl', { csfloat: { hasApiKey: true, openEntriesCount: 5 } })).integrations).toBe('CSFloat połączony · 5 do sprawdzenia');
  });

  test('Backup, Catálogo e Sobre só mostram estado quando o dado chegou', () => {
    expect(settingsStatuses(input(en, 'en')).backup).toBeNull();
    expect(settingsStatuses(input(en, 'en', { backupFolderReady: true })).backup).toBe('Backups folder ready');
    const catalog = { catalogUpdatedAt: '2026-11-20T10:00:00.000Z', total: 12345, countsBySource: {} } as unknown as CatalogStatus;
    expect(settingsStatuses(input(en, 'en', { catalog })).catalog).toMatch(/^12,345 items · updated /);
    expect(settingsStatuses(input(en, 'en', { catalog: { ...catalog, catalogUpdatedAt: null } })).catalog).toContain('Not updated yet');
    expect(settingsStatuses(input(en, 'en')).about).toBeNull();
    expect(settingsStatuses(input(en, 'en', { version: '2.0.0' })).about).toBe('v2.0.0');
  });

  test('sem as configurações, as seções que dependem delas ficam sem estado', () => {
    const out = settingsStatuses(input(en, 'en', { settings: null }));
    expect(out.fx).toBeNull();
    expect(out.aging).toBeNull();
    expect(out.preferences).toBe('Dark · Português (Brasil)');
  });
});

describe('sectionFromHash', () => {
  test('cada seção abre pelo próprio nome; sem hash ou desconhecido, Preferências', () => {
    for (const id of SETTINGS_SECTIONS) expect(sectionFromHash(`#${id}`)).toEqual({ section: id, scrollTo: null });
    expect(sectionFromHash('')).toEqual({ section: 'preferences', scrollTo: null });
    expect(sectionFromHash('#nada')).toEqual({ section: 'preferences', scrollTo: null });
  });
  test('#csfloat (links antigos) abre Integrações e rola até o cartão', () => {
    expect(sectionFromHash('#csfloat')).toEqual({ section: 'integrations', scrollTo: 'csfloat' });
    expect(sectionFromHash('#CSFloat')).toEqual({ section: 'integrations', scrollTo: 'csfloat' });
  });
});
