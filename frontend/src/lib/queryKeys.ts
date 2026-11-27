// Chaves de consulta do TanStack Query (D259). Fábrica pura: a invalidação é por prefixo.
// As chaves não levam o idioma (a API devolve dados neutros; o texto é traduzido na renderização).
export const queryKeys = {
  items: {
    all: ['items'] as const,
    list: (query: unknown) => ['items', 'list', query] as const,
    // Visão agrupada (D277): sob o prefixo `items`, então a invalidação atual a cobre.
    groups: (query: unknown) => ['items', 'groups', query] as const,
    // Candidatas e operações de uma unidade (10.3): sob o prefixo `items`, então toda invalidação de item as recarrega.
    candidates: (id: number) => ['items', 'candidates', id] as const,
    detachPreview: (id: number, componentId: number, share: number | null) => ['items', 'detachPreview', id, componentId, share] as const,
    // Efeito de desfazer a venda (12.6b): sempre buscado ao abrir (`staleTime: 0`).
    unsellPreview: (id: number) => ['items', 'unsellPreview', id] as const,
    operations: (id: number) => ['items', 'operations', id] as const,
    // Prévia da abertura de uma caixa, cápsula, pacote ou terminal (10.4).
    openOptions: (id: number) => ['items', 'openOptions', id] as const,
    // Unidade sugerida e arma vendida da aplicação retroativa (10.3, E-P2-Q47).
    retroSource: (id: number) => ['items', 'retroSource', id] as const,
    retroTarget: (id: number) => ['items', 'retroTarget', id] as const,
  },
  sales: { all: ['sales'] as const, list: (query: unknown) => ['sales', query] as const },
  // `feePreview`: exemplo da taxa do formulário de loja (12.8), sob o prefixo `stores`.
  stores: { all: ['stores'] as const, feePreview: (params: unknown) => ['stores', 'feePreview', params] as const },
  // Prévia da troca da moeda de conversão (11.3): sob o prefixo `settings`.
  settings: { all: ['settings'] as const, currencyPreview: (currency: string) => ['settings', 'currencyPreview', currency] as const },
  deposits: { all: ['deposits'] as const },
  withdrawals: { all: ['withdrawals'] as const },
  storeBalances: {
    all: ['storeBalances'] as const,
    current: ['storeBalances', 'current'] as const,
    history: (storeId: number) => ['storeBalances', 'history', storeId] as const,
  },
  profitSummary: { all: ['profitSummary'] as const },
  catalog: { all: ['catalog'] as const, status: ['catalog', 'status'] as const },
  health: { all: ['health'] as const },
  integrations: { all: ['integrations'] as const, csfloat: ['integrations', 'csfloat'] as const },
  // Importação (9.2, D318): lotes, um lote e as pendências abertas.
  imports: {
    all: ['imports'] as const,
    batches: ['imports', 'batches'] as const,
    batch: (id: number) => ['imports', 'batch', id] as const,
    entries: ['imports', 'entries'] as const,
    ignored: ['imports', 'ignored'] as const,
    cutoffPreview: (cutoffAt: string | null) => ['imports', 'cutoffPreview', cutoffAt] as const,
    undoPreview: (id: number) => ['imports', 'undoPreview', id] as const,
  },
  // Valor de mercado (10.6, D365): resumo e estado da atualização de preços.
  marketValues: { all: ['marketValues'] as const, summary: ['marketValues', 'summary'] as const },
  backupInfo: { all: ['backupInfo'] as const },
};
