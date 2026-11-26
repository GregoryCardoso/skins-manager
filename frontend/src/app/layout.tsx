import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import AppHeader from '@/components/AppHeader';
import CsfloatAutoImportHost from '@/components/CsfloatAutoImportHost';
import PriceAutoRefreshHost from '@/components/PriceAutoRefreshHost';
import FxAutoRefreshHost from '@/components/FxAutoRefreshHost';
import StartupOfflineModal from '@/components/StartupOfflineModal';
import DesktopUpdateHost from '@/components/DesktopUpdateHost';
import { PreferencesProvider } from '@/components/PreferencesProvider';
import QueryProvider from '@/components/QueryProvider';
import { I18nProvider } from '@/i18n/I18nProvider';
import { bootstrapScript } from '@/lib/preferences';
import './globals.css';

export const metadata: Metadata = {
  title: 'Skins Manager',
  description: 'CS2 item inventory and turnover',
  icons: { icon: [{ url: '/favicon.ico', sizes: '16x16 32x32 48x48' }, { url: '/icon.svg', type: 'image/svg+xml' }] },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootstrapScript() }} />
      </head>
      <body>
        <QueryProvider>
          <PreferencesProvider>
            <I18nProvider>
              <AppHeader />
              <main>{children}</main>
              <DesktopUpdateHost />
              <CsfloatAutoImportHost />
              <PriceAutoRefreshHost />
              <FxAutoRefreshHost />
              <StartupOfflineModal />
            </I18nProvider>
          </PreferencesProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
