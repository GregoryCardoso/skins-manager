import { describe, expect, test } from 'vitest';
import { tabFromHash } from './importsTabs';

describe('tabFromHash (Importações, 12.9)', () => {
  test('cada aba pelo nome; sem hash ou desconhecido cai em "Para conferir"', () => {
    expect(tabFromHash('#review')).toEqual({ tab: 'review', scrollTo: null });
    expect(tabFromHash('#ignored')).toEqual({ tab: 'ignored', scrollTo: null });
    expect(tabFromHash('#History')).toEqual({ tab: 'history', scrollTo: null });
    expect(tabFromHash('')).toEqual({ tab: 'review', scrollTo: null });
    expect(tabFromHash('#qualquer')).toEqual({ tab: 'review', scrollTo: null });
  });

  test('#cutoff abre o Histórico e rola até o bloco da data de corte', () => {
    expect(tabFromHash('#cutoff')).toEqual({ tab: 'history', scrollTo: 'cutoff' });
  });
});
