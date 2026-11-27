// Abas da página Importações (12.9): o hash da URL escolhe a aba. `#cutoff` abre o Histórico e rola até o bloco da data de corte.
export const IMPORT_TABS = ['review', 'ignored', 'history'] as const;
export type ImportTabId = (typeof IMPORT_TABS)[number];

export function tabFromHash(hash: string): { tab: ImportTabId; scrollTo: string | null } {
  const name = hash.replace(/^#/, '').toLowerCase();
  if (name === 'cutoff') return { tab: 'history', scrollTo: 'cutoff' };
  const found = IMPORT_TABS.find((id) => id === name);
  return { tab: found ?? 'review', scrollTo: null };
}
