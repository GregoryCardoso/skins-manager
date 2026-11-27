import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import CsfloatAutoImportHost from '@/components/CsfloatAutoImportHost';
import PriceAutoRefreshHost from '@/components/PriceAutoRefreshHost';
import DesktopUpdateHost from '@/components/DesktopUpdateHost';
import AppShell from '@/components/layout/AppShell';
import { PreferencesProvider } from '@/components/PreferencesProvider';
import QueryProvider from '@/components/QueryProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { I18nProvider } from '@/i18n/I18nProvider';
import en from '@/i18n/en.json';
import { bootstrapScript } from '@/lib/preferences';
import './globals.css';

// Sem 'title' no metadata: o Next reaplica o <title> do metadata a cada navegação e desfaria o do PageHeader.
// O <title> fixo no <head> abaixo é só o valor inicial (o layout raiz não é remontado ao navegar);
// cada página o troca pelo PageHeader ("{página} · {app}").
export const metadata: Metadata = {
  description: 'CS2 item inventory and turnover',
  icons: { icon: [{ url: '/favicon.ico', sizes: '16x16 32x32 48x48' }, { url: '/icon.svg', type: 'image/svg+xml' }] },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>{en.common.appName}</title>
        <script dangerouslySetInnerHTML={{ __html: bootstrapScript() }} />
      </head>
      <body>
        <QueryProvider>
          <PreferencesProvider>
            <I18nProvider>
              <TooltipProvider>
                <ToastProvider>
                  <AppShell>{children}</AppShell>
                  <DesktopUpdateHost />
                  <CsfloatAutoImportHost />
                  <PriceAutoRefreshHost />
                </ToastProvider>
              </TooltipProvider>
            </I18nProvider>
          </PreferencesProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
