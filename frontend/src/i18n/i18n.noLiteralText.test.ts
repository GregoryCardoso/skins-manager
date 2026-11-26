import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

// Etapa 11.10: nenhum texto visível ao usuário pode ficar literal em JSX; tudo passa pelos dicionários (t(...)).
// Sem parser de TypeScript disponível (o TS 7 não expõe a API em JavaScript), a busca é por expressões regulares, sobre o código
// sem comentários. Procura, em todo `.tsx` fora de testes: (a) texto solto entre `>` e `<`, (b) atributos de texto (aria-label,
// title, placeholder, alt, label...) com texto literal, (c) `{'texto'}` literal como filho. Exceções só na lista abaixo.

const SRC = path.join(__dirname, '..');
const TEXT_ATTRIBUTES = 'aria-label|aria-description|aria-placeholder|aria-roledescription|title|placeholder|alt|label';

// Chave: "<arquivo relativo a src, com />:<texto>". O valor é o motivo. `alt=""` (vazio) não é texto e é ignorado pela regra de letras.
const ALLOWED: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx') && !/\.test\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

const hasLetters = (text: string) => /\p{L}/u.test(text);

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1');
}

// Pedaços de código entre duas tags (`) : cond ? (`, `x &&`): não são texto da tela.
const looksLikeCode = (value: string) => /\s\?\s/.test(value) || /^[)(?:&|!]/.test(value) || /(&&|\|\||\?|\()$/.test(value);

export function findLiterals(code: string): string[] {
  const text = stripComments(code);
  const found: string[] = [];
  // (a) texto entre uma tag e outra; `>` de `=>` e `->` e genéricos como `Promise<...>` ficam de fora
  for (const m of text.matchAll(/(?<![=\-])>([^<>{}=;]*)</g)) {
    const value = m[1].replace(/\s+/g, ' ').trim();
    if (hasLetters(value) && !looksLikeCode(value)) found.push(value);
  }
  // texto em linhas próprias dentro de um elemento: `>` no fim de uma linha de tag e `<` no começo de outra
  for (const m of text.matchAll(/(?<![=\-])>[ \t]*\n([^<>{}=;]*)\n[ \t]*</g)) {
    const value = m[1].replace(/\s+/g, ' ').trim();
    if (hasLetters(value) && !looksLikeCode(value) && !found.includes(value)) found.push(value);
  }
  // (b) atributos de texto com literal
  for (const m of text.matchAll(new RegExp(String.raw`\s(?:${TEXT_ATTRIBUTES})=(?:"([^"]*)"|\{\s*(?:'([^']*)'|"([^"]*)")\s*\})`, 'g'))) {
    const value = m[1] ?? m[2] ?? m[3] ?? '';
    if (hasLetters(value)) found.push(value);
  }
  // (c) `{'texto'}` como filho (logo depois de `>` ou de outro `}`)
  for (const m of text.matchAll(/[>}]\s*\{\s*(?:'([^']*)'|"([^"]*)")\s*\}/g)) {
    const value = m[1] ?? m[2] ?? '';
    if (hasLetters(value)) found.push(value);
  }
  return found;
}

describe('texto literal em JSX (11.10)', () => {
  test('nenhum texto visível fora dos dicionários, salvo a lista de exceções', () => {
    const problems: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      for (const value of findLiterals(fs.readFileSync(file, 'utf8'))) {
        if (!(`${rel}:${value}` in ALLOWED)) problems.push(`${rel}: "${value}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('o detector encontra texto literal (guarda contra teste cego)', () => {
    const code = [
      'export const A = () => (',
      '  <div title="Oi" aria-label={"Tchau"}>',
      '    <b>Texto</b>',
      '    <p>',
      '      Linha própria',
      '    </p>',
      "    <i>{'x y'}</i>",
      '  </div>',
      ');',
    ].join('\n');
    const found = findLiterals(code);
    for (const expected of ['Oi', 'Tchau', 'Texto', 'Linha própria', 'x y']) expect(found).toContain(expected);
  });

  test('não confunde código com texto', () => {
    const code = [
      'const f = async (): Promise<Foo> => { return a > b ? c : d; };',
      '// <b>comentário</b>',
      'export const A = () => <div alt="">{t(\'a.b\')}</div>;',
    ].join('\n');
    expect(findLiterals(code)).toEqual([]);
  });
});
