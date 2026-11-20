import { ApiRequestError } from '@/services/api';

type LooseT = (key: string, params?: Record<string, string | number>) => string;

// Código conhecido -> texto traduzido; senão a mensagem do backend; senão "erro desconhecido".
export function errorMessageFor(error: unknown, t: LooseT): string {
  if (error instanceof ApiRequestError) {
    const key = `errors.${error.code}`;
    const translated = t(key);
    if (translated !== key) return translated;
    if (error.message.trim() !== '') return error.message;
  }
  return t('errors.UNKNOWN');
}
