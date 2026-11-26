import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import ja from './ja.json';
import ko from './ko.json';
import zhCN from './zh-CN.json';
import { translate, translatePlural } from './translate';
import { agoParts, formatAgo } from '@/lib/format';

// 11.9: textos finais montados como a interface os monta (dias por `common.dayCount`, tempo por `common.ago.*` e `tradeLock.units.*`),
// para garantir que a unidade não se repete ("5 日日", "前前") e que as frases ficam naturais em zh-CN, ja e ko.
const DICTS = { 'zh-CN': zhCN, ja, ko } as const;
type Code = keyof typeof DICTS;
const CODES = Object.keys(DICTS) as Code[];

const days = (code: Code, n: number) => translatePlural(DICTS[code], 'common.dayCount', n, code);
const t = (code: Code, key: string, params?: Record<string, string | number>) => translate(DICTS[code], key, params);

describe('textos com dias, tempo e idade em zh-CN, ja e ko (11.9)', () => {
  test.each(CODES)('%s: nenhum texto com {days}, {age} ou {time} repete a unidade ou o "atrás"', (code) => {
    const texts = [
      t(code, 'settings.fx.staleHint', { age: days(code, 3) }),
      t(code, 'inventory.daysForSale', { days: days(code, 5) }),
      t(code, 'inventory.daysInInventory', { days: days(code, 5) }),
      t(code, 'inventory.daysHeld', { days: days(code, 5) }),
      t(code, 'inventory.turnaround', { days: days(code, 5) }),
      t(code, 'sales.daysAfterRelease', { days: days(code, 5) }),
      t(code, 'filters.stagnantOnly', { days: days(code, 21) }),
      t(code, 'settings.aging.defaultValue', { days: days(code, 7) }),
      t(code, 'imports.won.turnoverHint', { days: days(code, 0) }),
      t(code, 'prices.status.updatedAgo', { time: formatAgo('2026-01-01T00:00:00Z', new Date('2026-01-01T00:05:00Z'), (key, params) => translate(DICTS[code], key, params)) }),
      t(code, 'inventory.inTradeLock', { time: `1${t(code, 'tradeLock.units.d')} 2${t(code, 'tradeLock.units.h')} 3${t(code, 'tradeLock.units.min')}` }),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/\{\w+\}/);
      expect(text).not.toMatch(/(日日|天天|일일|前前|전 전)/);
      expect(text).not.toMatch(/\d\s*(日|天|일)\s*(日|天|일)/);
    }
  });

  test('zh-CN: "3 天前", "5 分钟前" (o "前" vem só do texto da frase)', () => {
    expect(t('zh-CN', 'settings.fx.staleHint', { age: days('zh-CN', 3) })).toBe('这个汇率上次更新是 3 天前。请更新以获取最新汇率。');
    expect(t('zh-CN', 'prices.status.updatedAgo', { time: translate(zhCN, 'common.ago.minutes', { count: 5 }) })).toBe('价格更新于 5 分钟前');
  });

  test('ja: "3日前", e "1分未満" não vira "1分未満前"', () => {
    expect(t('ja', 'settings.fx.staleHint', { age: days('ja', 3) })).toBe('このレートは3日前に最後に更新されました。最新のレートに更新してください。');
    expect(t('ja', 'prices.status.updatedAgo', { time: translate(ja, 'common.ago.minutes', { count: 5 }) })).toBe('価格の更新から5分経過');
    expect(t('ja', 'prices.status.updatedAgo', { time: translate(ja, 'common.ago.lessThanMinute') })).toBe('価格の更新から1分未満経過');
  });

  test('ko: "3일 전" e "방금 전" ("방금" + "전") ficam naturais', () => {
    expect(t('ko', 'settings.fx.staleHint', { age: days('ko', 3) })).toBe('이 환율의 마지막 업데이트: 3일 전. 최신 환율로 업데이트해 주세요.');
    expect(t('ko', 'prices.status.updatedAgo', { time: translate(ko, 'common.ago.lessThanMinute') })).toBe('가격 업데이트: 방금 전');
    expect(t('ko', 'prices.status.updatedAgo', { time: translate(ko, 'common.ago.hours', { count: 2 }) })).toBe('가격 업데이트: 2시간 전');
  });

  test('o "há quanto tempo" usa as unidades certas por faixa', () => {
    for (const code of CODES) {
      expect(agoParts('2026-01-01T00:00:00Z', new Date('2026-01-03T00:00:00Z')).unit).toBe('DAYS');
      expect(translate(DICTS[code], 'common.ago.days', { count: 2 })).toMatch(/2/);
    }
  });
});

describe('fonte por idioma (D369, 11.9)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');

  test.each([
    ['zh-CN', 'Microsoft YaHei'],
    ['ja', 'Yu Gothic'],
    ['ja', 'Meiryo'],
    ['ko', 'Malgun Gothic'],
  ])('body:lang(%s) usa %s', (code, font) => {
    const rule = new RegExp(`body:lang\\(${code}\\)\\s*\\{[^}]*${font}[^}]*\\}`);
    expect(css).toMatch(rule);
  });

  test('o idioma da interface vai para o atributo lang do <html> (PreferencesProvider e script de abertura)', () => {
    const provider = fs.readFileSync(path.join(__dirname, '..', 'components', 'PreferencesProvider.tsx'), 'utf8');
    expect(provider).toMatch(/setAttribute\('lang', language\)/);
    const preferences = fs.readFileSync(path.join(__dirname, '..', 'lib', 'preferences.ts'), 'utf8');
    expect(preferences).toMatch(/setAttribute\('lang', language\)/);
  });
});
