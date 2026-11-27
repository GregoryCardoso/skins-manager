// Nome do item para exibição (11.5, D369): o `localizedName` (idioma das configurações, vem do backend) ou o nome canônico em inglês.
// Só exibição: filtros, vínculos e gravação continuam usando o nome em inglês.
export function localizedOrName(name: string, localizedName: string | null | undefined): string {
  return localizedName && localizedName.trim() !== '' ? localizedName : name;
}

interface NamedItem {
  name: string;
  catalog?: { localizedName: string | null } | null;
}

export function itemDisplayName(item: NamedItem): string {
  return localizedOrName(item.name, item.catalog?.localizedName);
}

// Dica com o nome em inglês quando o exibido é a tradução.
export function englishNameTitle(name: string, localizedName: string | null | undefined): string | undefined {
  return localizedOrName(name, localizedName) !== name ? name : undefined;
}

export function itemEnglishTitle(item: NamedItem): string | undefined {
  return englishNameTitle(item.name, item.catalog?.localizedName);
}

// Nome de um item do catálogo para exibição: o do idioma escolhido (`localizedName`) quando existe, senão o canônico em inglês.
export function catalogDisplayName(item: { name: string; localizedName?: string | null }): string {
  return item.localizedName?.trim() ? item.localizedName : item.name;
}
