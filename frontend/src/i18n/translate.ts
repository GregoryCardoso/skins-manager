import en from './en.json';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

// O inglês é o idioma base (D369): é a fonte do tipo das chaves.
export type Messages = typeof en;
export type MessageKey = Leaves<Messages>;
export type TranslateParams = Record<string, string | number>;

function lookup(messages: unknown, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (node !== null && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === 'string' ? node : undefined;
}

function fill(text: string, params?: TranslateParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

// Plural pelas categorias do CLDR (`Intl.PluralRules`): `key` aponta para um objeto com `zero`, `one`, `two`, `few`, `many` e
// `other`. Quando a contagem é 0 e o objeto tem `zero`, vale o `zero` em qualquer idioma ("Nenhuma venda"); senão vale a categoria do número no idioma (russo: one/few/many/other; chinês: só other). A forma que o idioma não tem
// cai em `other`. Se o idioma não tem o texto, vale o do idioma base (com as regras do inglês).
export function translatePlural(
  messages: unknown,
  key: string,
  count: number,
  locale: string,
  params?: TranslateParams,
  baseMessages?: unknown,
): string {
  const own = pluralText(messages, key, count, locale);
  if (own !== undefined) return fill(own, { count, ...params });
  if (baseMessages !== undefined) {
    const base = pluralText(baseMessages, key, count, 'en');
    if (base !== undefined) return fill(base, { count, ...params });
  }
  if (process.env.NODE_ENV === 'development') console.warn(`[i18n] chave ausente: ${key}`);
  return `${key}.other`;
}

function pluralText(messages: unknown, key: string, count: number, locale: string): string | undefined {
  if (count === 0) {
    const zero = lookup(messages, `${key}.zero`);
    if (zero !== undefined) return zero;
  }
  let category: string;
  try {
    category = new Intl.PluralRules(locale).select(count);
  } catch {
    category = 'other';
  }
  return lookup(messages, `${key}.${category}`) ?? lookup(messages, `${key}.other`);
}

// `baseMessages` (o inglês) é a reserva: chave ausente no idioma mostra o texto em inglês, e só quando nem o inglês tem a chave (desenvolvimento) avisa no console.
export function translate(messages: unknown, key: string, params?: TranslateParams, baseMessages?: unknown): string {
  const own = lookup(messages, key);
  if (own !== undefined) return fill(own, params);
  if (baseMessages !== undefined) {
    const base = lookup(baseMessages, key);
    if (base !== undefined) return fill(base, params);
  }
  if (process.env.NODE_ENV === 'development') console.warn(`[i18n] chave ausente: ${key}`);
  return key;
}
