// Abas Aportes e Saques da página Lucro real (12.7b, P6): o estado fica na URL (`?tab=withdrawals`), compatível com a exportação
// estática (lido no navegador, sem `useSearchParams`). Qualquer outro valor abre os Aportes.
export const PROFIT_TABS = ['deposits', 'withdrawals'] as const;
export type ProfitTabId = (typeof PROFIT_TABS)[number];

export function profitTabFromSearch(search: string): ProfitTabId {
  const value = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('tab');
  return PROFIT_TABS.find((id) => id === value) ?? 'deposits';
}

// Nova query string com a aba escolhida; mantém os outros parâmetros e deixa a URL limpa na aba padrão.
export function searchWithProfitTab(search: string, tab: ProfitTabId): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (tab === 'deposits') params.delete('tab');
  else params.set('tab', tab);
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}
