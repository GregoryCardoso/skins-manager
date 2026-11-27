// Verificadores de cor fixa compartilhados pelos testes (ui/noFixedColors.test.ts e styles/noHardcodedColors.test.ts).
export const COLOR_PROPS = /^(color|background|background-color|background-image|border|border-[a-z-]+|fill|stroke|outline|outline-color|box-shadow|text-decoration-color|caret-color|accent-color)$/;
export const NAMED_COLORS = [
  'white', 'black', 'red', 'green', 'blue', 'gray', 'grey', 'orange', 'yellow', 'purple', 'pink', 'brown', 'cyan', 'magenta', 'silver',
  'gold', 'navy', 'teal', 'lime', 'maroon', 'olive', 'aqua', 'fuchsia', 'coral', 'crimson', 'indigo', 'violet', 'tomato', 'salmon', 'khaki',
];

// Remove var(...) (com um nível de parênteses aninhado, como var(--a, var(--b))).
const stripVars = (value: string) => value.replace(/var\((?:[^()]|\([^()]*\))*\)/g, ' ');

export function cssProblems(css: string): string[] {
  const problems: string[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const m of text.matchAll(/(^|[;{\s])([a-z-]+)\s*:\s*([^;{}]+)(?=;|})/g)) {
    const [, , prop, rawValue] = m;
    const value = stripVars(rawValue);
    if (/#[0-9a-fA-F]{3,8}\b/.test(value) || /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i.test(value)) problems.push(`${prop}: ${rawValue.trim()}`);
    else if (COLOR_PROPS.test(prop) && NAMED_COLORS.some((name) => new RegExp(`(^|[\\s,(])${name}(?=[\\s,)]|$)`, 'i').test(value))) problems.push(`${prop}: ${rawValue.trim()}`);
  }
  return problems;
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1');
}

export function tsxProblems(code: string): string[] {
  const problems: string[] = [];
  const text = stripComments(code);
  if (/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/.test(text.replace(/&#\d+;/g, ''))) problems.push('hex');
  if (/\b(rgba?|hsla?|oklch)\(/i.test(text)) problems.push('função de cor');
  for (const m of text.matchAll(/style=\{\{([^}]*)\}\}/g)) {
    if (/color|background|border|fill|stroke|outline|shadow/i.test(m[1])) problems.push(`style: ${m[1].trim()}`);
  }
  return problems;
}

// Varredura mais larga (12.11): hex, função de cor ou nome de cor como texto literal em qualquer `style={{ ... }}` e hex/função de cor em
// qualquer lugar do .tsx. Valores vindos de variável/token (ex.: `style={{ background: palette.bg }}`) não são literais e passam.
export function literalColorProblems(code: string): string[] {
  const problems: string[] = [];
  const text = stripComments(code);
  if (/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/.test(text.replace(/&#\d+;/g, ''))) problems.push('hex');
  if (/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i.test(text)) problems.push('função de cor');
  for (const m of text.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    const body = m[1];
    if (NAMED_COLORS.some((name) => new RegExp(`['"\`]\\s*${name}\\s*['"\`]`, 'i').test(body))) problems.push(`style com nome de cor: ${body.trim()}`);
  }
  return problems;
}
