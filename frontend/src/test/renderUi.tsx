import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { StaticI18nProvider } from '@/i18n/I18nProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { TooltipProvider } from '@/components/ui/Tooltip';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Language } from '@/types/api';

// Renderiza um componente dentro do provedor de idioma estático (sem PreferencesProvider), com o TooltipProvider que o layout traz
// (12.4) e, com `withToast`, o ToastProvider também. Padrão: inglês.
// Os dicionários dos outros idiomas vêm do JSON (import dinâmico), via `loadMessages`.
export interface RenderUiOptions extends Omit<RenderOptions, 'wrapper'> {
  language?: Language;
  messages?: Dictionary;
  // Verdadeiro: com o ToastProvider do layout (a região de avisos entra no DOM, então fica desligado por padrão).
  withToast?: boolean;
  // Com um QueryClient, o componente roda dentro do QueryClientProvider (componentes do layout que usam useQuery).
  client?: QueryClient;
}

export function renderUi(ui: ReactElement, { language = 'en', messages, withToast = false, client, ...options }: RenderUiOptions = {}): RenderResult {
  const wrapper = ({ children }: { children: ReactNode }) => {
    const inner = (
      <StaticI18nProvider language={language} messages={messages}>
        <TooltipProvider>{withToast ? <ToastProvider>{children}</ToastProvider> : children}</TooltipProvider>
      </StaticI18nProvider>
    );
    return client ? <QueryClientProvider client={client}>{inner}</QueryClientProvider> : inner;
  };
  return render(ui, { wrapper, ...options });
}

// Dicionário completo de um idioma (para `renderUi(..., { language, messages })`).
export async function loadMessages(language: Language): Promise<Dictionary> {
  const { loadDictionary } = await import('@/i18n/dictionaries');
  return loadDictionary(language);
}

// Simula a janela (largura x altura) para o `matchMedia` do jsdom, que não calcula layout. Entende `(min-width: Npx)`,
// `(min-height: Npx)`, `(width < Npx)` e `(height < Npx)`; o resto (movimento reduzido, tema) dá falso.
export function setViewport(width: number, height = 900): void {
  window.matchMedia = ((query: string) => {
    const test = (kind: 'min-width' | 'min-height' | 'width <' | 'height <', size: number) => {
      const value = kind.endsWith('width') || kind === 'width <' ? width : height;
      return kind.startsWith('min-') ? value >= size : value < size;
    };
    let matches = false;
    for (const [, kind, size] of query.matchAll(/\((min-width|min-height|width <|height <)\s*:?\s*(\d+)px\)/g)) {
      matches = test(kind as 'min-width', Number(size));
    }
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList;
  }) as typeof window.matchMedia;
}
