import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import de from '@/i18n/de.json';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import it from '@/i18n/it.json';
import ptBR from '@/i18n/pt-BR.json';
import { LANGUAGE_REGISTRY, isMachineTranslated } from '@/i18n/languages';
import { translate } from '@/i18n/translate';

// 11.7 (E-P3-Q4): aviso "a tradução pode ter erros" só nos idiomas traduzidos pelo Claude (campo `machineTranslated` do registro).
const DICTS = { en, 'pt-BR': ptBR, es, fr, it, de } as const;
const LANG = { current: 'es' as keyof typeof DICTS };
vi.mock('@/i18n/I18nProvider', () => {
  const t = (key: string, params?: Record<string, string | number>) => translate(DICTS[LANG.current], key, params);
  return { useT: () => t };
});

import TranslationNotice, { ISSUES_URL } from './TranslationNotice';

const render = (language: keyof typeof DICTS) => {
  LANG.current = language;
  return renderToStaticMarkup(createElement(TranslationNotice, { language }));
};

describe('aviso de tradução', () => {
  test('o registro marca exatamente es, fr, it e de; en, pt-BR e desconhecido não', () => {
    const marked = LANGUAGE_REGISTRY.filter((entry) => isMachineTranslated(entry.code)).map((entry) => entry.code as string);
    expect(marked).toEqual(['es', 'fr', 'it', 'de']);
    expect(isMachineTranslated('en')).toBe(false);
    expect(isMachineTranslated('pt-BR')).toBe(false);
    expect(isMachineTranslated('xx')).toBe(false);
  });

  test.each(['en', 'pt-BR'] as const)('%s: não aparece', (language) => {
    expect(render(language)).toBe('');
  });

  test.each(['es', 'fr', 'it', 'de'] as const)('%s: aparece, no idioma, com o link das Issues em nova aba', (language) => {
    const html = render(language);
    expect(html).toContain('data-testid="translation-notice"');
    expect(html).toContain(`href="${ISSUES_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(DICTS[language].settings.preferences.translationNoticeLink);
    expect(html).not.toContain('{link}');
    expect(html).not.toContain('\u0001');
  });

  test('o link aponta para as Issues do repositório e é https', () => {
    expect(ISSUES_URL).toBe('https://github.com/GregoryCardoso/skins-manager/issues');
  });

  test('todos os idiomas têm o texto com {link} e o nome do link', () => {
    for (const [code, dict] of Object.entries(DICTS)) {
      expect([code, dict.settings.preferences.translationNotice.includes('{link}')]).toEqual([code, true]);
      expect([code, dict.settings.preferences.translationNoticeLink.trim() === '']).toEqual([code, false]);
    }
  });

  test('fica no cartão de Preferências, logo depois da dica da moeda', () => {
    const source = fs.readFileSync(path.join(__dirname, 'PreferencesSettings.tsx'), 'utf8');
    expect(source).toMatch(/<TranslationNotice language=\{language\} \/>/);
    expect(source.indexOf("t('currency.hint')")).toBeLessThan(source.indexOf('<TranslationNotice'));
  });
});
