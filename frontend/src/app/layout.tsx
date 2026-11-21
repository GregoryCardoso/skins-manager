import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import AppHeader from '@/components/AppHeader';
import DesktopUpdateHost from '@/components/DesktopUpdateHost';
import { PreferencesProvider } from '@/components/PreferencesProvider';
import { I18nProvider } from '@/i18n/I18nProvider';
import { bootstrapScript } from '@/lib/preferences';
import './globals.css';

export const metadata: Metadata = {
  title: 'Skins Manager',
  description: 'Inventário e giro de itens de CS2',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootstrapScript() }} />
      </head>
      <body>
        <PreferencesProvider>
          <I18nProvider>
            <AppHeader />
            <main>{children}</main>
            <DesktopUpdateHost />
          </I18nProvider>
        </PreferencesProvider>
      </body>
    </html>
  );
}
