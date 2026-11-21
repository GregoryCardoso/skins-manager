import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import ReleaseNotes from '@/components/ReleaseNotes';
import { parseInline, parseReleaseMarkdown, safeLinkHref, selectReleaseNotes, type Block, type Inline } from './releaseNotes';

// Testes de QA da v1.0.2: lacunas além de releaseNotes.test.ts (segurança das notas e divisão por idioma).

const render = (markdown: string) => renderToStaticMarkup(createElement(ReleaseNotes, { markdown }));

function collectLinks(nodes: Inline[], insideLink = false, found: { href: string; nested: boolean }[] = []) {
  for (const node of nodes) {
    if (node.type === 'link') {
      found.push({ href: node.href, nested: insideLink });
      collectLinks(node.children, true, found);
    } else if (node.type === 'strong' || node.type === 'em') {
      collectLinks(node.children, insideLink, found);
    }
  }
  return found;
}

function allInlines(blocks: Block[]): Inline[] {
  const out: Inline[] = [];
  for (const block of blocks) {
    if (block.type === 'paragraph' || block.type === 'heading') out.push(...block.children);
    if (block.type === 'list') {
      for (const item of block.items) {
        out.push(...item.children);
        if (item.sublist) out.push(...allInlines([item.sublist]));
      }
    }
  }
  return out;
}

// Garante, no HTML final, que nenhum atributo de evento nem esquema perigoso existe dentro de uma tag.
function expectNoDangerousMarkup(html: string) {
  for (const tag of html.matchAll(/<[^>]+>/g)) {
    expect(tag[0], tag[0]).not.toMatch(/\son\w+\s*=/i);
    expect(tag[0], tag[0]).not.toMatch(/(javascript|vbscript|data):/i);
  }
  expect(html).not.toMatch(/<(script|img|iframe|svg|object|embed|style|link|meta|form|input)/i);
  for (const m of html.matchAll(/href="([^"]*)"/g)) expect(m[1].startsWith('https://')).toBe(true);
}

describe('QA: esquemas perigosos em links markdown', () => {
  const C = (n: number) => String.fromCharCode(n);
  test.each([
    ['vbscript', '[x](vbscript:msgbox(1))'],
    ['VBScript misto', '[x](VbScRiPt:msgbox(1))'],
    ['data html base64', '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'],
    ['DATA maiúsculo', '[x](DATA:text/html,x)'],
    ['JaVaScRiPt misto', '[x](JaVaScRiPt:alert(document.cookie))'],
    ['controle \\x01 antes', `[x](${C(1)}javascript:alert(1))`],
    ['controle \\x00 antes', `[x](${C(0)}javascript:alert(1))`],
    ['controle \\x1f antes', `[x](${C(0x1f)}javascript:alert(1))`],
    ['nbsp antes', `[x](${C(0xa0)}javascript:alert(1))`],
    ['espaço de largura zero antes', `[x](${C(0x200b)}javascript:alert(1))`],
    ['BOM antes', `[x](${C(0xfeff)}javascript:alert(1))`],
    ['tab no meio do esquema', '[x](java\tscript:alert(1))'],
    ['entidade decimal', '[x](&#106;avascript:alert(1))'],
    ['entidade hexadecimal', '[x](&#x6A;avascript:alert(1))'],
    ['entidade sem ponto e vírgula', '[x](&#106avascript:alert(1))'],
    ['entidade no esquema inteiro', '[x](&#104;&#116;&#116;&#112;&#115;://a.com)'],
    ['esquema codificado em %', '[x](%6Aavascript:alert(1))'],
    ['barra invertida', '[x](https:\\\\evil.example)'],
    ['https com usuário e senha', '[x](https://user:pass@evil.example/)'],
    ['https com só usuário', '[x](https://admin@evil.example/)'],
    ['https com uma barra', '[x](https:/evil.example)'],
    ['https sem barras', '[x](https:evil.example)'],
    ['https só o esquema', '[x](https:)'],
    ['https com host vazio e porta', '[x](https://:443/)'],
    ['link em maiúsculas sem host', '[x](HTTPS://)'],
    ['destino com < > e javascript', '[x](<javascript:alert(1)>)'],
    ['destino entre < > relativo', '[x](<//evil.example>)'],
    ['ftp', '[x](ftp://evil.example/a)'],
    ['blob', '[x](blob:https://a.com/uuid)'],
    ['about', '[x](about:blank)'],
    ['ms-msdt', '[x](ms-msdt:/id)'],
    ['search-ms', '[x](search-ms:query=a)'],
    ['URL com 3000 caracteres', `[x](https://a.com/${'a'.repeat(3000)})`],
  ])('%s: nenhum link e nenhum href no HTML', (_n, markdown) => {
    const blocks = parseReleaseMarkdown(markdown);
    expect(collectLinks(allInlines(blocks))).toEqual([]);
    const html = render(markdown);
    expect(html).not.toContain('<a');
    expect(html).not.toContain('href');
    expectNoDangerousMarkup(html);
  });

  test('o rótulo do link recusado continua visível como texto', () => {
    const html = render('[clique aqui](javascript:alert(1))');
    expect(html).toContain('clique aqui');
    expect(html).not.toContain('javascript');
  });

  test('imagem com esquema perigoso ou remoto: só o texto alternativo, nada carregado', () => {
    for (const md of ['![alt](javascript:alert(1))', '![alt](https://evil.example/x.png)', '![alt](data:image/svg+xml,<svg onload=alert(1)>)']) {
      const html = render(md);
      expect(html).toContain('alt');
      expect(html).not.toMatch(/<img|src=|href=/i);
    }
  });

  test('imagem como rótulo de link: o link https continua seguro e sem <img>', () => {
    const html = render('[![logo](https://a.com/l.png)](https://b.com/)');
    expect(html).not.toMatch(/<img/i);
    expectNoDangerousMarkup(html);
  });
});

describe('QA: URLs https com aspas, > e caracteres especiais', () => {
  test('aspas na URL nunca fecham o atributo href', () => {
    const html = render('[x](https://a.com/"onmouseover="alert(1))');
    expectNoDangerousMarkup(html);
    // o atributo href não pode ser seguido de um segundo atributo vindo da URL
    for (const tag of html.matchAll(/<a [^>]*>/g)) {
      const attrs = [...tag[0].matchAll(/\s([a-z-]+)=/g)].map((m) => m[1]);
      expect(attrs).toEqual(['href', 'target', 'rel', 'class']);
    }
  });

  test('> e < na URL são codificados ou escapados', () => {
    const html = render('[x](https://a.com/a>b<c)');
    expectNoDangerousMarkup(html);
    expect(html).not.toMatch(/href="[^"]*[<>]/);
  });

  test('destino entre < > com https vale; destino com título é cortado no espaço', () => {
    expect(collectLinks(allInlines(parseReleaseMarkdown('[x](<https://a.com/p>)')))).toEqual([{ href: 'https://a.com/p', nested: false }]);
    expect(collectLinks(allInlines(parseReleaseMarkdown('[x](https://a.com/p "javascript:alert(1)")')))).toEqual([
      { href: 'https://a.com/p', nested: false },
    ]);
  });

  test('safeLinkHref: normaliza a URL e recusa os formatos perigosos', () => {
    expect(safeLinkHref('https://A.com/a b')).toBe('https://a.com/a%20b');
    expect(safeLinkHref('https://a.com:443/')).toBe('https://a.com/');
    for (const bad of ['https://u:p@a.com', 'https://u@a.com', 'https://', 'https:', 'https:a.com', 'JAVASCRIPT:1', '\u0001https://a.com', 'http://a.com']) {
      expect(safeLinkHref(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  test('https:/// (barras extras) é normalizado pelo URL padrão para um host real, nunca para host vazio', () => {
    // WHATWG: "https:///x" vira host "x". Não é brecha: o host nunca é vazio e o link continua https.
    expect(safeLinkHref('https:///x')).toBe('https://x/');
    expect(safeLinkHref('https:////')).toBeNull();
  });

  test('uma mistura grande de entradas nunca produz markup perigoso', () => {
    const pieces = [
      '[a](https://ok.com)', '[b](javascript:1)', '<script>', '</script>', '<img onerror=1>', '**', '_', '`', '[', ']', '(', ')',
      '!', '\\', '<!--', '-->', '\n', '- ', '# ', '> ', '```\n', '<a href="javascript:1">', '[c](<https://x.com>)', '[d](data:x)',
    ];
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let round = 0; round < 300; round += 1) {
      let md = '';
      const len = 5 + (rnd() % 40);
      for (let i = 0; i < len; i += 1) md += pieces[rnd() % pieces.length];
      expectNoDangerousMarkup(render(md));
    }
  });
});

describe('QA: HTML cru, entidades e links aninhados', () => {
  test('anchor HTML cru e entidades aparecem como texto escapado', () => {
    const html = render('<a href="javascript:alert(1)">x</a> &#106;avascript: &lt;script&gt;');
    expect(html).not.toContain('<a');
    expect(html).toContain('&lt;a href=');
    // o & do texto é escapado pelo React: a entidade não é interpretada
    expect(html).toContain('&amp;#106;avascript:');
    expect(html).toContain('&amp;lt;script&amp;gt;');
  });

  test('<script> dentro de rótulo de link, de negrito e de título', () => {
    expectNoDangerousMarkup(render('[**<script>alert(1)</script>**](https://a.com)'));
    expectNoDangerousMarkup(render('## <img src=x onerror=alert(1)> título'));
    expectNoDangerousMarkup(render('1. <svg onload=alert(1)>'));
  });

  test('comentário HTML com script dentro some sem deixar markup', () => {
    const html = render('antes <!-- <script>alert(1)</script> --> depois');
    expectNoDangerousMarkup(html);
    expect(html).toContain('antes');
    expect(html).toContain('depois');
  });

  test.each([
    '[[a](https://x.com)](https://y.com)',
    '[a [b](https://x.com) c](https://y.com)',
    '[a [b [c](https://x.com)](https://y.com)](https://z.com)',
    '**[a](https://x.com)**',
    '[**[a](https://x.com)**](https://y.com)',
    '[[[[[a](https://x.com)',
    '[a](https://x.com)](https://y.com)',
    '[a]((https://x.com))',
    '[a](https://x.com/(b))',
  ])('links aninhados nunca geram <a> dentro de <a>: %s', (md) => {
    const links = collectLinks(allInlines(parseReleaseMarkdown(md)));
    expect(links.filter((l) => l.nested)).toEqual([]);
    const html = render(md);
    expect(html).not.toMatch(/<a [^>]*>(?:(?!<\/a>).)*<a /s);
    expectNoDangerousMarkup(html);
  });

  test.each([
    '[', ']', '[]', '[](', '[a](', '[a]()', ']]]][[[[', '[a](b', '[a]b)', '![', '![a', '![a](', '![a](b', '[[[[[[[]]]]]]]',
    '[a](https://x.com', '[a](https://x.com\n)', '(((((', '))))', '[a]\n(https://x.com)', '[a] (https://x.com)',
  ])('colchetes e parênteses desbalanceados não quebram: %j', (md) => {
    expect(() => parseReleaseMarkdown(md)).not.toThrow();
    expect(() => render(md)).not.toThrow();
    expectNoDangerousMarkup(render(md));
  });

  test('colchete e parêntese separados por espaço ou quebra não formam link', () => {
    expect(render('[a] (https://x.com)')).not.toContain('<a');
    expect(render('[a]\n(https://x.com)')).not.toContain('<a');
  });
});

describe('QA: desempenho e profundidade com entradas grandes', () => {
  const hostile: [string, string][] = [
    ['links abertos', '[a](https://a.com'.repeat(10000)],
    ['rótulos sem fim', '[a'.repeat(50000)],
    ['fechos soltos', ']('.repeat(50000)],
    ['links válidos em sequência', '[a](https://a.com) '.repeat(10000)],
    ['asteriscos alternados', '*a _'.repeat(25000)],
    ['negritos e itálicos', '**a *b '.repeat(15000)],
    ['crases desiguais', '` `` ``` '.repeat(10000)],
    ['imagens abertas', '![a'.repeat(30000)],
    ['colchetes dentro de negrito', '**[a](https://a.com)** '.repeat(8000)],
    ['barras e aspas', '\\"\\'.repeat(50000)],
    ['comentários sem fim', '<!-- '.repeat(40000)],
    ['comentários vazios', '<!---->'.repeat(30000)],
    ['listas profundas', Array.from({ length: 3000 }, (_, i) => ' '.repeat(i % 60) + '- item').join('\n')],
    ['cercas alternadas', '```\n~~~\n'.repeat(10000)],
    ['linhas gigantes', 'a'.repeat(200000)],
    ['várias quebras', '\n'.repeat(100000)],
    ['citações em cadeia', '>'.repeat(100000)],
    ['hifens e espaços', '- '.repeat(50000)],
    ['marcadores de idioma', '<!-- en -->\n<!-- pt-BR -->\n'.repeat(10000)],
  ];

  test.each(hostile)('%s: termina rápido e sem estourar a pilha', (_n, input) => {
    const started = performance.now();
    const blocks = parseReleaseMarkdown(selectReleaseNotes(input, 'en'));
    parseInline(input);
    expect(blocks).toBeDefined();
    expect(performance.now() - started).toBeLessThan(1500);
  });

  test('renderização do HTML de uma entrada de 20 000 caracteres é rápida', () => {
    const input = '- **a** [b](https://a.com) `c`\n'.repeat(650).slice(0, 20000);
    const started = performance.now();
    render(input);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('aninhamento profundo de colchetes, parênteses e crases não estoura a pilha', () => {
    const depth = 20000;
    for (const input of ['['.repeat(depth) + 'a' + ']'.repeat(depth), '('.repeat(depth), '*'.repeat(depth) + 'a' + '*'.repeat(depth), '> '.repeat(depth) + 'a']) {
      expect(() => parseReleaseMarkdown(input)).not.toThrow();
    }
  });
});

describe('QA: divisão por idioma (D192)', () => {
  test('marcador com espaços e maiúsculas dentro e fora', () => {
    const md = '   <!--    PT-br    -->   \nolá\n\t<!--EN-->\t\nhello';
    expect(selectReleaseNotes(md, 'pt-BR')).toBe('olá');
    expect(selectReleaseNotes(md, 'en')).toBe('hello');
    expect(selectReleaseNotes(md, 'EN')).toBe('hello');
  });

  test('comentário no meio da linha ou com texto na mesma linha não é marcador', () => {
    const md = '<!-- en -->\nA\nB <!-- pt-BR --> C\n<!-- pt-BR --> D\n<!-- pt-BR -->\nE';
    expect(selectReleaseNotes(md, 'en')).toBe('A\nB <!-- pt-BR --> C\n<!-- pt-BR --> D');
    expect(selectReleaseNotes(md, 'pt-BR')).toBe('E');
  });

  test('tags inválidas (uma letra, com sublinhado, três partes, vazia) não são marcadores', () => {
    const md = '<!-- en -->\nA\n<!-- x -->\n<!-- pt_BR -->\n<!-- pt-BR-x -->\n<!---->\n<!-- -->';
    expect(selectReleaseNotes(md, 'en')).toBe('A\n<!-- x -->\n<!-- pt_BR -->\n<!-- pt-BR-x -->\n<!---->\n<!-- -->');
    // e esses comentários somem na renderização
    expect(parseReleaseMarkdown(selectReleaseNotes(md, 'en'))).toEqual([{ type: 'paragraph', children: [{ type: 'text', text: 'A' }] }]);
  });

  test('seções repetidas do mesmo idioma juntam na ordem, ignorando as de outros', () => {
    const md = '<!-- en -->\nA\n<!-- pt-BR -->\nX\n<!-- EN -->\nB\n<!-- es -->\nY\n<!-- en -->\nC';
    expect(selectReleaseNotes(md, 'en')).toBe('A\n\nB\n\nC');
  });

  test('só um idioma presente: o outro idioma mostra esse mesmo (reserva)', () => {
    expect(selectReleaseNotes('<!-- en -->\nOnly English', 'pt-BR')).toBe('Only English');
    expect(selectReleaseNotes('<!-- pt-BR -->\nSó português', 'en')).toBe('Só português');
  });

  test('idioma ausente com várias seções: todas na ordem, sem marcadores', () => {
    expect(selectReleaseNotes('<!-- pt-BR -->\nA\n<!-- en -->\nB', 'es')).toBe('A\n\nB');
  });

  test('seção do idioma só com espaços cai na reserva', () => {
    expect(selectReleaseNotes('<!-- pt-BR -->\n   \n\n<!-- en -->\nB', 'pt-BR')).toBe('B');
  });

  test('texto antes do primeiro marcador aparece nos dois idiomas e também na reserva', () => {
    const md = 'Comum\n<!-- pt-BR -->\nA\n<!-- en -->\nB';
    expect(selectReleaseNotes(md, 'pt-BR')).toBe('Comum\n\nA');
    expect(selectReleaseNotes(md, 'en')).toBe('Comum\n\nB');
    expect(selectReleaseNotes(md, 'fr')).toBe('Comum\n\nA\n\nB');
  });

  test('só preâmbulo e marcadores vazios: sobra o preâmbulo', () => {
    expect(selectReleaseNotes('Comum\n<!-- en -->\n<!-- pt-BR -->', 'en')).toBe('Comum');
  });

  test('CRLF e CR com marcadores', () => {
    const md = 'Comum\r\n<!-- pt-BR -->\r\nA\r\nA2\r\n<!-- en -->\r\nB\r\n';
    expect(selectReleaseNotes(md, 'pt-BR')).toBe('Comum\n\nA\nA2');
    expect(selectReleaseNotes(md, 'en')).toBe('Comum\n\nB');
    expect(selectReleaseNotes(md.replace(/\r\n/g, '\r'), 'en')).toBe('Comum\n\nB');
    expect(selectReleaseNotes(md, 'en')).not.toContain('\r');
  });

  test('sem marcadores: o texto todo, aparado, em qualquer idioma', () => {
    expect(selectReleaseNotes('\n  # T  \r\ntexto\n\n', 'xx')).toBe('# T  \ntexto');
  });

  test('a troca de idioma muda o conteúdo renderizado na hora (mesma entrada, idiomas diferentes)', () => {
    const md = '<!-- pt-BR -->\n- **Novo**\n<!-- en -->\n- **New**';
    const pt = render(selectReleaseNotes(md, 'pt-BR'));
    const en = render(selectReleaseNotes(md, 'en'));
    expect(pt).toContain('Novo');
    expect(pt).not.toContain('New');
    expect(en).toContain('New');
    expect(en).not.toContain('Novo');
  });

  test('idioma desconhecido ou vazio não quebra', () => {
    const md = '<!-- pt-BR -->\nA\n<!-- en -->\nB';
    expect(selectReleaseNotes(md, '')).toBe('A\n\nB');
    expect(selectReleaseNotes(md, '??')).toBe('A\n\nB');
  });

  test('marcador dentro de bloco de código também divide (limitação conhecida, documentada no teste)', () => {
    const md = '<!-- en -->\n```\n<!-- pt-BR -->\n```';
    expect(selectReleaseNotes(md, 'en')).toBe('```');
  });
});
