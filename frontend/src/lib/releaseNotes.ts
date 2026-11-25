// Notas da versão (D192, D193): divisão por idioma e um renderizador de markdown mínimo, sem HTML e sem dependência.
// Tudo é puro e de tempo linear: a entrada chega limitada a 20 000 caracteres (D191), mas as funções não confiam nisso.
import { isHttpsLink } from './safeUrl';

// ---------------------------------------------------------------------------
// Divisão por idioma (D192)
// ---------------------------------------------------------------------------

// Linha que contém só `<!-- tag -->`, com espaços opcionais dentro e fora; `tag` no formato `xx` ou `xx-YY`.
// Procurada linha a linha (sem regex sobre o texto inteiro).
const MARKER_LINE = /^[ \t]*<!--[ \t]*([A-Za-z0-9]{2,8}(?:-[A-Za-z0-9]{2,8})?)[ \t]*-->[ \t]*$/;

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export function selectReleaseNotes(markdown: string, language: string): string {
  const text = normalizeNewlines(typeof markdown === 'string' ? markdown : '');
  const preamble: string[] = [];
  const sections: { tag: string; lines: string[] }[] = [];
  for (const line of text.split('\n')) {
    const marker = MARKER_LINE.exec(line);
    if (marker) {
      sections.push({ tag: marker[1].toLowerCase(), lines: [] });
    } else if (sections.length === 0) {
      preamble.push(line);
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }
  // Sem nenhum marcador: mostra tudo.
  if (sections.length === 0) return text.trim();

  const head = preamble.join('\n').trim();
  const partsOf = (tag: string) =>
    sections
      .filter((section) => section.tag === tag)
      .map((section) => section.lines.join('\n').trim())
      .filter((part) => part !== '');
  // Seção do idioma; sem ela (ou só vazia), a seção `en` (o inglês é o idioma base, D369); sem ela também, todas, na ordem,
  // sem os marcadores.
  const own = partsOf(language.toLowerCase());
  const english = partsOf('en');
  const chosen =
    own.length > 0
      ? own
      : english.length > 0
        ? english
        : sections.map((section) => section.lines.join('\n').trim()).filter((part) => part !== '');
  return [head, ...chosen].filter((part) => part !== '').join('\n\n');
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] };

export interface ListItem {
  children: Inline[];
  // Segundo nível (o que tiver mais recuo); não há terceiro.
  sublist: ListBlock | null;
}

export interface ListBlock {
  type: 'list';
  ordered: boolean;
  items: ListItem[];
}

export type Block =
  | { type: 'heading'; level: 3 | 4 | 5; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | ListBlock
  | { type: 'code'; text: string }
  | { type: 'hr' };

// ---------------------------------------------------------------------------
// Inline (D193)
// ---------------------------------------------------------------------------

const MAX_URL_LENGTH = 2048;

// Só `https://` com host; o href devolvido é o normalizado pelo `URL`. Qualquer outra coisa: null (vira texto).
export function safeLinkHref(raw: string): string | null {
  const url = raw.trim();
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return null;
  if (!/^https:\/\//i.test(url) || !isHttpsLink(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname === '' || parsed.username !== '' || parsed.password !== '') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const SPACE = /\s/;

function pushText(out: Inline[], text: string): void {
  if (text === '') return;
  const last = out[out.length - 1];
  if (last && last.type === 'text') last.text += text;
  else out.push({ type: 'text', text });
}

function pushAll(out: Inline[], nodes: Inline[]): void {
  for (const node of nodes) {
    if (node.type === 'text') pushText(out, node.text);
    else out.push(node);
  }
}

// Varredura linear: `find` guarda a última busca de cada texto, para que delimitadores sem par (ou colchetes
// repetidos) nunca varram o texto de novo a cada ocorrência.
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const memo = new Map<string, { from: number; index: number }>();
  const find = (needle: string, from: number): number => {
    const known = memo.get(needle);
    if (known && known.from <= from && (known.index === -1 || known.index >= from)) return known.index;
    const index = text.indexOf(needle, from);
    memo.set(needle, { from, index });
    return index;
  };

  // Fecha um `*` ou `_` simples: ignora sequências de dois ou mais (que são negrito).
  const findSingleCloser = (char: string, from: number): number => {
    let position = from;
    for (;;) {
      const index = find(char, position);
      if (index === -1) return -1;
      if (text[index + 1] !== char) return index;
      let end = index;
      while (text[end] === char) end += 1;
      position = end;
    }
  };

  let buffer = '';
  const flush = () => {
    pushText(out, buffer);
    buffer = '';
  };

  // `[rótulo](destino)` a partir de `start` (que aponta para `[`). Devolve null se não for um link inteiro.
  const readLink = (start: number): { label: string; url: string; end: number } | null => {
    const close = find(']', start + 1);
    if (close === -1 || text[close + 1] !== '(') return null;
    const paren = find(')', close + 2);
    if (paren === -1) return null;
    let target = text.slice(close + 2, paren).trim();
    const space = target.search(/\s/);
    if (space !== -1) target = target.slice(0, space); // o título opcional é ignorado
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    return { label: text.slice(start + 1, close), url: target, end: paren + 1 };
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i];

    if (char === '\\' && i + 1 < text.length && PUNCTUATION.test(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if (char === '`') {
      let run = 0;
      while (text[i + run] === '`') run += 1;
      const fence = '`'.repeat(run);
      const close = find(fence, i + run);
      if (close !== -1) {
        flush();
        let code = text.slice(i + run, close);
        if (code.length > 1 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') code = code.slice(1, -1);
        out.push({ type: 'code', text: code });
        i = close + run;
      } else {
        buffer += fence;
        i += run;
      }
      continue;
    }

    if (char === '!' && text[i + 1] === '[') {
      // Imagem: só o texto alternativo; nada remoto é carregado.
      const link = readLink(i + 1);
      if (link) {
        buffer += link.label;
        i = link.end;
      } else {
        buffer += char;
        i += 1;
      }
      continue;
    }

    if (char === '[') {
      const link = readLink(i);
      if (link) {
        flush();
        const children = parseInline(link.label);
        const href = safeLinkHref(link.url);
        if (href) out.push({ type: 'link', href, children });
        else pushAll(out, children);
        i = link.end;
      } else {
        buffer += char;
        i += 1;
      }
      continue;
    }

    if (char === '*' || char === '_') {
      const delimiter = text[i + 1] === char ? char + char : char;
      const contentStart = i + delimiter.length;
      let closeAt = -1;
      const opensOk =
        contentStart < text.length &&
        !SPACE.test(text[contentStart]) &&
        (char === '*' || i === 0 || !WORD_CHAR.test(text[i - 1]));
      if (opensOk) {
        closeAt = delimiter.length === 1 ? findSingleCloser(char, contentStart) : find(delimiter, contentStart);
      }
      const closes =
        closeAt > contentStart &&
        !SPACE.test(text[closeAt - 1]) &&
        (char === '*' || closeAt + delimiter.length >= text.length || !WORD_CHAR.test(text[closeAt + delimiter.length]));
      if (closes) {
        flush();
        const children = parseInline(text.slice(contentStart, closeAt));
        out.push({ type: delimiter.length === 2 ? 'strong' : 'em', children });
        i = closeAt + delimiter.length;
      } else {
        buffer += delimiter;
        i += delimiter.length;
      }
      continue;
    }

    buffer += char;
    i += 1;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Blocos (D193)
// ---------------------------------------------------------------------------

// Remove comentários HTML `<!-- ... -->` em uma passada. Um comentário sem fechamento fica como texto.
function stripHtmlComments(text: string): string {
  let result = '';
  let position = 0;
  for (;;) {
    const open = text.indexOf('<!--', position);
    if (open === -1) return result + text.slice(position);
    const close = text.indexOf('-->', open + 4);
    if (close === -1) return result + text.slice(position);
    result += text.slice(position, open);
    position = close + 3;
  }
}

function expandLeadingTabs(line: string): string {
  let end = 0;
  while (end < line.length && (line[end] === ' ' || line[end] === '\t')) end += 1;
  return line.slice(0, end).replace(/\t/g, '    ') + line.slice(end);
}

function leadingSpaces(line: string): number {
  let count = 0;
  while (line[count] === ' ') count += 1;
  return count;
}

const HR_LINE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST_LINE = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(\S.*)$/;

// Título `#` a `######` sem regex sobre o texto livre: `#` vira nível 3, `##` nível 4 e o resto nível 5.
function readHeading(line: string): { level: 3 | 4 | 5; content: string } | null {
  const start = leadingSpaces(line);
  if (start > 3) return null;
  let hashes = 0;
  while (line[start + hashes] === '#') hashes += 1;
  if (hashes < 1 || hashes > 6) return null;
  const after = line[start + hashes];
  if (after !== ' ' && after !== '\t') return null;
  let content = line.slice(start + hashes).trim();
  let end = content.length;
  while (end > 0 && content[end - 1] === '#') end -= 1;
  if (end < content.length && (end === 0 || content[end - 1] === ' ' || content[end - 1] === '\t')) {
    content = content.slice(0, end).trim();
  }
  return { level: hashes === 1 ? 3 : hashes === 2 ? 4 : 5, content };
}

function fenceOf(line: string): string | null {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('```')) return '```';
  if (trimmed.startsWith('~~~')) return '~~~';
  return null;
}

export function parseReleaseMarkdown(markdown: string): Block[] {
  const lines = normalizeNewlines(stripHtmlComments(typeof markdown === 'string' ? markdown : ''))
    .split('\n')
    .map(expandLeadingTabs);
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list = null as ListBlock | null; // (as: o TS não enxerga as atribuições feitas dentro das funções abaixo)
  let listBase = 0;
  let lastItem = null as ListItem | null;
  let lastItemText: string[] = [];
  let lastItemTarget = null as ListItem | null;

  const closeItemText = () => {
    if (lastItemTarget) lastItemTarget.children = parseInline(lastItemText.join(' '));
    lastItemTarget = null;
    lastItemText = [];
  };
  const closeList = () => {
    closeItemText();
    list = null;
    lastItem = null;
  };
  const closeParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  const closeAll = () => {
    closeParagraph();
    closeList();
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    const fence = fenceOf(line);
    if (fence) {
      closeAll();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith(fence)) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // pula a cerca de fechamento (ou o fim do texto, se não fechou)
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }

    if (line.trim() === '') {
      closeParagraph(); // a lista continua aberta: uma linha em branco entre itens não a encerra
      index += 1;
      continue;
    }

    if (HR_LINE.test(line)) {
      closeAll();
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    const heading = readHeading(line);
    if (heading) {
      closeAll();
      blocks.push({ type: 'heading', level: heading.level, children: parseInline(heading.content) });
      index += 1;
      continue;
    }

    const item = LIST_LINE.exec(line);
    if (item) {
      closeParagraph();
      const indent = item[1].length;
      const ordered = /^\d/.test(item[2]);
      const entry: ListItem = { children: [], sublist: null };
      closeItemText();
      const parent: ListItem | null = lastItem;
      if (list !== null && parent !== null && indent >= listBase + 2) {
        // segundo nível: vira sublista do último item do primeiro nível (mais recuo que isso fica no segundo nível)
        if (!parent.sublist || parent.sublist.ordered !== ordered) parent.sublist = { type: 'list', ordered, items: [] };
        parent.sublist.items.push(entry);
      } else {
        let target: ListBlock | null = list;
        if (target === null || target.ordered !== ordered) {
          closeList();
          target = { type: 'list', ordered, items: [] };
          blocks.push(target);
          list = target;
          listBase = indent;
        }
        target.items.push(entry);
        lastItem = entry;
      }
      lastItemTarget = entry;
      lastItemText = [item[3].trim()];
      index += 1;
      continue;
    }

    // Linha comum. Em uma lista aberta, uma linha recuada continua o item.
    if (list && lastItemTarget && leadingSpaces(line) >= listBase + 2) {
      lastItemText.push(line.trim());
      index += 1;
      continue;
    }
    closeList();
    // `>` no início da linha é tirado, e a linha vira parágrafo (citações e tabelas viram texto simples).
    let text = line.trim();
    while (text.startsWith('>')) text = text.slice(1).trimStart();
    if (text !== '') paragraph.push(text);
    index += 1;
  }
  closeAll();
  return blocks;
}
