// Preferência "menu recolhido" (D370, 12.4): estado da janela, não um dado pessoal. Fica só no localStorage (sem coluna no banco,
// sem ir para o backup). Nunca lança; valor ausente ou inválido = expandido.
export const NAV_COLLAPSED_STORAGE_KEY = 'sm.navCollapsed';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readNavCollapsed(storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(NAV_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeNavCollapsed(value: boolean, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(NAV_COLLAPSED_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // Sem permissão ou espaço: o menu só não lembra da escolha.
  }
}
