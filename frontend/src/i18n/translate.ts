import ptBR from './pt-BR.json';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type Messages = typeof ptBR;
export type MessageKey = Leaves<Messages>;
export type TranslateParams = Record<string, string | number>;

export function translate(messages: unknown, key: string, params?: TranslateParams): string {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (node !== null && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      node = undefined;
      break;
    }
  }
  if (typeof node !== 'string') {
    if (process.env.NODE_ENV === 'development') console.warn(`[i18n] chave ausente: ${key}`);
    return key;
  }
  if (!params) return node;
  return node.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
