// Lê as variáveis CSS de src/styles/tokens.css por bloco (claro, escuro, sistema). Usado pelo teste de contraste e pelo guia /design.
export function readBlock(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`bloco ${selector} não encontrado`);
  const body = css.slice(start + selector.length + 2, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

export const LIGHT_SELECTOR = ':root';
export const DARK_SELECTOR = ":root[data-theme='dark']";
export const SYSTEM_DARK_SELECTOR = ':root:not([data-theme])';
