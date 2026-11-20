// Defesa em profundidade (D102/D106): só esquemas conhecidos chegam ao DOM.

function parse(value: unknown): URL | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

// Imagem do catálogo: apenas https:// com host.
export function isSafeImageUrl(value: unknown): value is string {
  const url = parse(value);
  return url !== null && url.protocol === 'https:' && url.hostname !== '';
}

// Link de inspeção: steam:// ou https://.
export function isSafeInspectLink(value: unknown): value is string {
  const url = parse(value);
  return url !== null && (url.protocol === 'steam:' || url.protocol === 'https:');
}

export function isHttpsLink(value: string): boolean {
  return parse(value)?.protocol === 'https:';
}
