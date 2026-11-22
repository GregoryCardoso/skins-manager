// Chaves de consulta do TanStack Query (D259). Fábrica pura: a invalidação é por prefixo.
// As chaves não levam o idioma (a API devolve dados neutros; o texto é traduzido na renderização).
export const queryKeys = {
  items: {
    all: ['items'] as const,
    list: (query: unknown) => ['items', 'list', query] as const,
    // Visão agrupada (D277): sob o prefixo `items`, então a invalidação atual a cobre.
    groups: (query: unknown) => ['items', 'groups', query] as const,
  },
  sales: { all: ['sales'] as const, list: (query: unknown) => ['sales', query] as const },
  stores: { all: ['stores'] as const },
  settings: { all: ['settings'] as const },
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
  backupInfo: { all: ['backupInfo'] as const },
};
