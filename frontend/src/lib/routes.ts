import type { IconName } from '@/components/ui/Icon';
import type { MessageKey } from '@/i18n/translate';

// Itens do menu lateral (D370, 12.4). Só dados: quem desenha é o SideNav.
export type NavId = 'inventory' | 'sales' | 'profit' | 'stores' | 'imports' | 'settings';

export interface NavItem {
  id: NavId;
  href: string;
  icon: IconName;
  labelKey: MessageKey;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'inventory', href: '/', icon: 'inventory', labelKey: 'nav.inventory' },
  { id: 'sales', href: '/sales/', icon: 'sales', labelKey: 'nav.sales' },
  { id: 'profit', href: '/profit/', icon: 'profit', labelKey: 'nav.profit' },
  { id: 'stores', href: '/stores/', icon: 'stores', labelKey: 'nav.stores' },
  { id: 'imports', href: '/imports/', icon: 'imports', labelKey: 'nav.imports' },
];

export const SETTINGS_ITEM: NavItem = { id: 'settings', href: '/settings/', icon: 'settings', labelKey: 'nav.settings' };

// Item ativo pelo caminho: "/" só exato; os outros por prefixo, com ou sem a barra final. Caminho desconhecido = null.
export function activeNavId(pathname: string | null | undefined): NavId | null {
  const path = (pathname ?? '').split(/[?#]/)[0].replace(/\/+$/, '');
  if (path === '') return 'inventory';
  for (const item of [...NAV_ITEMS, SETTINGS_ITEM]) {
    if (item.id === 'inventory') continue;
    const base = item.href.replace(/\/+$/, '');
    if (path === base || path.startsWith(`${base}/`)) return item.id;
  }
  return null;
}
