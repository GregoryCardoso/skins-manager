'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { readNavCollapsed, writeNavCollapsed } from '@/lib/navCollapse';
import styles from './AppShell.module.css';
import ConnectionGate from './ConnectionGate';
import GlobalNotices from './GlobalNotices';
import SideNav from './SideNav';
import { navModeFor, useNavViewport } from './useNavMode';

// Estrutura de toda página (D370, 12.4): "pular para o conteúdo", o menu lateral e a coluna do conteúdo (avisos globais + a página,
// atrás do porteiro da conexão). O atributo data-nav diz como o menu está (expanded, collapsed ou overlay).
export default function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const { wide, short } = useNavViewport();
  // A preferência "menu recolhido" só é lida depois da hidratação (o HTML pré-gerado é sempre o expandido). O atributo que o script de
  // abertura põe no <html> já deixou a coluna estreita na primeira pintura, então não há salto.
  const [collapsedPref, setCollapsedPref] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);

  useEffect(() => {
    setCollapsedPref(readNavCollapsed());
  }, []);

  // Navegar ou alargar a janela fecha o menu aberto por cima.
  useEffect(() => {
    setOverlayOpen(false);
  }, [pathname, wide]);

  const mode = navModeFor({ wide, collapsedPref, overlayOpen });
  const closeOverlay = useCallback(() => setOverlayOpen(false), []);

  const toggle = useCallback(() => {
    if (!wide) {
      // Faixa estreita: abrir por cima não muda a preferência.
      setOverlayOpen((open) => !open);
      return;
    }
    const next = !collapsedPref;
    setCollapsedPref(next);
    writeNavCollapsed(next);
    if (next) document.documentElement.setAttribute('data-nav-collapsed', '1');
    else document.documentElement.removeAttribute('data-nav-collapsed');
  }, [wide, collapsedPref]);

  const skip = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById('main-content')?.focus();
  };

  return (
    <div className={styles.shell} data-nav={mode}>
      <a href="#main-content" className={styles.skipLink} onClick={skip}>
        {t('layout.skipToContent')}
      </a>
      <SideNav mode={mode} short={short} onToggle={toggle} onCloseOverlay={closeOverlay} />
      <main id="main-content" tabIndex={-1} className={styles.main}>
        <GlobalNotices />
        <ConnectionGate>{children}</ConnectionGate>
      </main>
    </div>
  );
}
