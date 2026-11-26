import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { StaticI18nProvider } from '@/i18n/I18nProvider';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Language } from '@/types/api';

// Renderiza um componente dentro do provedor de idioma estático (sem PreferencesProvider). Padrão: inglês.
// Os dicionários dos outros idiomas vêm do JSON (import dinâmico), via `loadMessages`.
export interface RenderUiOptions extends Omit<RenderOptions, 'wrapper'> {
  language?: Language;
  messages?: Dictionary;
}

export function renderUi(ui: ReactElement, { language = 'en', messages, ...options }: RenderUiOptions = {}): RenderResult {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StaticI18nProvider language={language} messages={messages}>
      {children}
    </StaticI18nProvider>
  );
  return render(ui, { wrapper, ...options });
}

// Dicionário completo de um idioma (para `renderUi(..., { language, messages })`).
export async function loadMessages(language: Language): Promise<Dictionary> {
  const { loadDictionary } = await import('@/i18n/dictionaries');
  return loadDictionary(language);
}
