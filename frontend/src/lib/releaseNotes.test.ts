import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import ReleaseNotes from '@/components/ReleaseNotes';
import { parseInline, parseReleaseMarkdown, safeLinkHref, selectReleaseNotes, type Block, type Inline } from './releaseNotes';

const render = (markdown: string) => renderToStaticMarkup(createElement(ReleaseNotes, { markdown }));
const textOf = (nodes: Inline[]): string =>
  nodes
    .map((node) => (node.type === 'text' || node.type === 'code' ? node.text : textOf(node.children)))
    .join('');
const paragraphText = (blocks: Block[]) => blocks.map((b) => (b.type === 'paragraph' ? textOf(b.children) : '')).join('|');

describe('selectReleaseNotes (D192)', () => {
  const both = '<!-- pt-BR -->\n## Novidades\n- a\n\n<!-- en -->\n## What is new\n- b';

  test('sem marcador mostra tudo', () => {
    expect(selectReleaseNotes('## Olá\n- a', 'en')).toBe('## Olá\n- a');
    expect(selectReleaseNotes('', 'pt-BR')).toBe('');
  });

  test('escolhe a seção do idioma, sem o marcador', () => {
    expect(selectReleaseNotes(both, 'pt-BR')).toBe('## Novidades\n- a');
    expect(selectReleaseNotes(both, 'en')).toBe('## What is new\n- b');
  });

  test('maiúsculas, minúsculas e espaços no marcador não importam', () => {
    const md = '  <!--PT-br-->  \nA\n<!--   EN   -->\nB';
    expect(selectReleaseNotes(md, 'pt-BR')).toBe('A');
    expect(selectReleaseNotes(md, 'en')).toBe('B');
    expect(selectReleaseNotes('<!-- pt-br -->\nA\n<!-- en -->\nB', 'pt-BR')).toBe('A');
  });

  test('o preâmbulo vale para todos os idiomas, no topo', () => {
    const md = 'Intro\n\n<!-- pt-BR -->\nA\n<!-- en -->\nB';
    expect(selectReleaseNotes(md, 'pt-BR')).toBe('Intro\n\nA');
    expect(selectReleaseNotes(md, 'en')).toBe('Intro\n\nB');
  });

  test('seções repetidas do mesmo idioma são juntadas na ordem', () => {
    const md = '<!-- en -->\nA\n<!-- pt-BR -->\nX\n<!-- en -->\nB';
    expect(selectReleaseNotes(md, 'en')).toBe('A\n\nB');
  });

  test('idioma ausente ou com seção vazia: mostra todas, sem os marcadores', () => {
    expect(selectReleaseNotes('<!-- pt-BR -->\nSó português', 'en')).toBe('Só português');
    expect(selectReleaseNotes('<!-- pt-BR -->\nA\n<!-- en -->\n\n  \n', 'en')).toBe('A');
    expect(selectReleaseNotes('Intro\n<!-- pt-BR -->\nA\n<!-- es -->\nC', 'en')).toBe('Intro\n\nA\n\nC');
  });

  test('seção de outra tag (es) só aparece na reserva', () => {
    const md = '<!-- pt-BR -->\nA\n<!-- es -->\nC';
    expect(selectReleaseNotes(md, 'pt-BR')).toBe('A');
  });

  test('comentário no meio da linha não é marcador', () => {
    const md = 'Texto <!-- en --> mais\n<!-- pt-BR -->\nA';
    expect(selectReleaseNotes(md, 'pt-BR')).toBe('Texto <!-- en --> mais\n\nA');
    expect(selectReleaseNotes('a <!-- en --> b', 'en')).toBe('a <!-- en --> b');
    expect(selectReleaseNotes('<!-- en --> b', 'en')).toBe('<!-- en --> b');
  });

  test('CRLF e CR viram \\n', () => {
    expect(selectReleaseNotes('<!-- pt-BR -->\r\nA\r\n<!-- en -->\r\nB', 'en')).toBe('B');
    expect(selectReleaseNotes('a\r\nb', 'en')).toBe('a\nb');
  });

  test('entrada que não é texto não quebra', () => {
    expect(selectReleaseNotes(undefined as unknown as string, 'en')).toBe('');
    expect(selectReleaseNotes(null as unknown as string, 'en')).toBe('');
  });
});

describe('parseReleaseMarkdown: blocos (D193)', () => {
  test('títulos: # vira 3, ## vira 4 e o resto vira 5', () => {
    const blocks = parseReleaseMarkdown('# A\n## B\n### C\n#### D\n###### E');
    expect(blocks.map((b) => (b.type === 'heading' ? b.level : 0))).toEqual([3, 4, 5, 5, 5]);
    expect(textOf((blocks[0] as { children: Inline[] }).children)).toBe('A');
  });

  test('título exige espaço depois do #, e # com mais de seis é parágrafo', () => {
    expect(parseReleaseMarkdown('#semespaço')[0].type).toBe('paragraph');
    expect(parseReleaseMarkdown('####### sete')[0].type).toBe('paragraph');
    expect(textOf((parseReleaseMarkdown('## Título ##')[0] as { children: Inline[] }).children)).toBe('Título');
  });

  test('listas com -, *, + e numeradas', () => {
    const blocks = parseReleaseMarkdown('- a\n- b\n\n1. um\n2) dois');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'list', ordered: false });
    expect(blocks[1]).toMatchObject({ type: 'list', ordered: true });
    expect((blocks[0] as { items: unknown[] }).items).toHaveLength(2);
    expect(parseReleaseMarkdown('* x\n+ y')[0]).toMatchObject({ type: 'list', ordered: false });
  });

  test('segundo nível; o que tiver mais recuo fica no segundo nível', () => {
    const [list] = parseReleaseMarkdown('- pai\n  - filho\n      - neto\n- outro');
    expect(list.type).toBe('list');
    const items = (list as { items: { children: Inline[]; sublist: { items: unknown[] } | null }[] }).items;
    expect(items).toHaveLength(2);
    expect(textOf(items[0].children)).toBe('pai');
    expect(items[0].sublist?.items).toHaveLength(2);
    expect(items[1].sublist).toBeNull();
  });

  test('linha recuada continua o item; texto sem recuo encerra a lista', () => {
    const blocks = parseReleaseMarkdown('- primeira\n  continuação\nParágrafo');
    expect(blocks).toHaveLength(2);
    const items = (blocks[0] as { items: { children: Inline[] }[] }).items;
    expect(textOf(items[0].children)).toBe('primeira continuação');
    expect(paragraphText(blocks)).toBe('|Parágrafo');
  });

  test('parágrafos: linhas seguidas são juntadas com espaço; linha em branco separa', () => {
    expect(paragraphText(parseReleaseMarkdown('a\nb\n\nc'))).toBe('a b|c');
  });

  test('bloco de código com cercas, só texto', () => {
    const [block] = parseReleaseMarkdown('```js\nconst a = **x**;\n<b>y</b>\n```');
    expect(block).toEqual({ type: 'code', text: 'const a = **x**;\n<b>y</b>' });
    expect(parseReleaseMarkdown('```\nsem fechar\nmais')[0]).toEqual({ type: 'code', text: 'sem fechar\nmais' });
  });

  test('linha divisória', () => {
    for (const rule of ['---', '***', '___', '- - -', '  ***  ']) {
      expect(parseReleaseMarkdown(rule)).toEqual([{ type: 'hr' }]);
    }
    expect(parseReleaseMarkdown('--')[0].type).toBe('paragraph');
  });

  test('citação vira parágrafo sem o >, e tabela vira texto', () => {
    expect(paragraphText(parseReleaseMarkdown('> citado\n>> mais'))).toBe('citado mais');
    expect(paragraphText(parseReleaseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |'))).toContain('| a | b |');
  });

  test('comentários HTML saem; comentário sem fechamento fica como texto', () => {
    expect(paragraphText(parseReleaseMarkdown('a <!-- x --> b'))).toBe('a  b');
    expect(paragraphText(parseReleaseMarkdown('a <!-- aberto'))).toBe('a <!-- aberto');
  });

  test('entrada vazia ou que não é texto', () => {
    expect(parseReleaseMarkdown('')).toEqual([]);
    expect(parseReleaseMarkdown(undefined as unknown as string)).toEqual([]);
  });
});

describe('parseInline (D193)', () => {
  test('negrito, itálico e código', () => {
    expect(parseInline('a **b** c')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'strong', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' c' },
    ]);
    expect(parseInline('*i*')[0]).toMatchObject({ type: 'em' });
    expect(parseInline('__b__')[0]).toMatchObject({ type: 'strong' });
    expect(parseInline('_i_')[0]).toMatchObject({ type: 'em' });
    expect(parseInline('`x`')).toEqual([{ type: 'code', text: 'x' }]);
  });

  test('dentro do código nada é interpretado', () => {
    expect(parseInline('`**a** [x](https://a.com) <b>`')).toEqual([{ type: 'code', text: '**a** [x](https://a.com) <b>' }]);
  });

  test('itálico dentro de negrito e vice-versa', () => {
    expect(textOf(parseInline('**a *b* c**'))).toBe('a b c');
    expect(parseInline('**a *b* c**')[0]).toMatchObject({ type: 'strong' });
    expect(textOf(parseInline('*a **b** c*'))).toBe('a b c');
  });

  test('o _ só conta na borda de palavra', () => {
    expect(parseInline('snake_case_name')).toEqual([{ type: 'text', text: 'snake_case_name' }]);
    expect(parseInline('foo_bar_')).toEqual([{ type: 'text', text: 'foo_bar_' }]);
  });

  test('pares não fechados ficam como texto literal', () => {
    for (const raw of ['**sem fechar', '*sem fechar', '`sem fechar', '[sem fechar', '[a](sem fechar', '__x', '**', '*', '* solto *']) {
      expect(textOf(parseInline(raw))).toBe(raw);
      expect(parseInline(raw).every((n) => n.type === 'text')).toBe(true);
    }
  });

  test('delimitadores com espaço dentro não abrem', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ type: 'text', text: '2 * 3 * 4' }]);
  });

  test('\\ escapa o caractere seguinte', () => {
    expect(parseInline('\\*não\\* \\[x\\] \\`c')).toEqual([{ type: 'text', text: '*não* [x] `c' }]);
    expect(parseInline('barra \\a letra')).toEqual([{ type: 'text', text: 'barra \\a letra' }]);
    expect(parseInline('fim\\')).toEqual([{ type: 'text', text: 'fim\\' }]);
  });

  test('link https vira link; título opcional é ignorado', () => {
    expect(parseInline('[Releases](https://github.com/GregoryCardoso/skins-manager/releases)')).toEqual([
      {
        type: 'link',
        href: 'https://github.com/GregoryCardoso/skins-manager/releases',
        children: [{ type: 'text', text: 'Releases' }],
      },
    ]);
    expect(parseInline('[a](https://a.com "título")')[0]).toMatchObject({ type: 'link', href: 'https://a.com/' });
    expect(parseInline('[a](<https://a.com>)')[0]).toMatchObject({ type: 'link' });
  });

  test('imagem: só o texto alternativo', () => {
    expect(parseInline('![logo](https://a.com/x.png)')).toEqual([{ type: 'text', text: 'logo' }]);
    expect(parseInline('a ![](https://a.com/x.png) b')).toEqual([{ type: 'text', text: 'a  b' }]);
    expect(parseInline('!solto')).toEqual([{ type: 'text', text: '!solto' }]);
  });

  test('URL solta não vira link', () => {
    expect(parseInline('veja https://a.com agora').every((n) => n.type === 'text')).toBe(true);
  });
});

describe('links e HTML malicioso (V102-Q3)', () => {
  const hrefOnlyHttps = (html: string) => {
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    return hrefs.every((h) => h.startsWith('https://'));
  };

  test.each([
    ['javascript', '[x](javascript:alert(1))'],
    ['javascript misto', '[x](JaVaScRiPt:alert(1))'],
    ['javascript com espaço antes', '[x]( javascript:alert(1))'],
    ['javascript com tab', '[x](\tjavascript:alert(1))'],
    ['javascript com quebra no meio', '[x](java\nscript:alert(1))'],
    ['data', '[x](data:text/html,<script>alert(1)</script>)'],
    ['http', '[x](http://exemplo.com)'],
    ['protocolo relativo', '[x](//evil.example/a)'],
    ['caminho relativo', '[x](/settings)'],
    ['arquivo', '[x](file:///C:/Windows/System32/calc.exe)'],
    ['steam', '[x](steam://rungame/730)'],
    ['mailto', '[x](mailto:a@b.com)'],
    ['https sem host', '[x](https:foo)'],
    ['https só o esquema', '[x](https://)'],
    ['https com usuário', '[x](https://user:pw@evil.example/)'],
    ['vazio', '[x]()'],
  ])('%s: sem href, só o texto', (_name, markdown) => {
    const html = render(markdown);
    expect(html).not.toContain('href');
    expect(html).not.toContain('<a ');
    expect(textOf(parseInline(markdown))).toContain('x');
  });

  test('link https vira <a> com target e rel seguros', () => {
    const html = render('[ok](https://github.com/GregoryCardoso/skins-manager/releases)');
    expect(html).toContain('href="https://github.com/GregoryCardoso/skins-manager/releases"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  test('safeLinkHref aceita só https com host', () => {
    expect(safeLinkHref('https://a.com/x')).toBe('https://a.com/x');
    expect(safeLinkHref('  https://a.com  ')).toBe('https://a.com/');
    for (const bad of ['', ' ', 'http://a.com', 'javascript:alert(1)', 'https:a', 'HTTPS:/a', '//a.com', 'https://' + 'a'.repeat(3000)]) {
      expect(safeLinkHref(bad)).toBeNull();
    }
  });

  test('HTML aparece como texto literal e nunca vira elemento', () => {
    const inputs = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<b onmouseover="x">negrito</b>',
      '<iframe src="https://evil.example"></iframe>',
      '<a href="javascript:alert(1)">x</a>',
      '<svg/onload=alert(1)>',
      '- <script>alert(1)</script>\n- **<img onerror=x>**',
      '# <script>',
      '```\n<script>alert(1)</script>\n```',
      '`<script>alert(1)</script>`',
      '[<script>alert(1)</script>](https://a.com)',
      '![<img onerror=x>](https://a.com/x.png)',
    ];
    for (const input of inputs) {
      const html = render(input);
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<img/i);
      expect(html).not.toMatch(/<iframe/i);
      expect(html).not.toMatch(/<svg/i);
      expect(html).not.toMatch(/<[^>]*\son\w+\s*=/i);
      expect(hrefOnlyHttps(html)).toBe(true);
    }
    expect(render('<script>alert(1)</script>')).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('o markup gerado só tem as tags permitidas', () => {
    const html = render(
      '# T\n## U\n### V\n\n**b** *i* `c` [l](https://a.com)\n\n- a\n  - b\n1. c\n\n```\ncode\n```\n\n---\n\n> q',
    );
    const tags = new Set([...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase()));
    const allowed = new Set(['div', 'h3', 'h4', 'h5', 'p', 'strong', 'em', 'code', 'a', 'ul', 'ol', 'li', 'pre', 'hr']);
    for (const tag of tags) expect(allowed.has(tag), tag).toBe(true);
  });

  test('não usa dangerouslySetInnerHTML', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    for (const file of ['ReleaseNotes.tsx', 'UpdateModal.tsx', 'DesktopUpdateHost.tsx']) {
      const source = fs.readFileSync(path.join(__dirname, '..', 'components', file), 'utf8');
      expect(source).not.toMatch(/dangerouslySetInnerHTML|innerHTML|eval\(/);
    }
    const lib = fs.readFileSync(path.join(__dirname, 'releaseNotes.ts'), 'utf8');
    expect(lib).not.toMatch(/dangerouslySetInnerHTML|innerHTML|eval\(/);
  });
});

describe('desempenho (entrada de até 20 000 caracteres)', () => {
  const inputs: [string, string][] = [
    ['asteriscos', '*'.repeat(20000)],
    ['colchetes', '['.repeat(20000)],
    ['colchetes com fecho', '[]('.repeat(6666)],
    ['links abertos', '[a](b'.repeat(4000)],
    ['sublinhados', '_'.repeat(20000)],
    ['crases', '`'.repeat(20000)],
    ['crases alternadas', '` ``'.repeat(5000)],
    ['asteriscos soltos', '*a '.repeat(6666)],
    ['negritos abertos', '**a *b '.repeat(2857)],
    ['barras', '\\'.repeat(20000)],
    ['sinais de menor', '<!--'.repeat(5000)],
    ['hifens', '-'.repeat(20000)],
    ['espaços', ' '.repeat(20000)],
    ['cerquilhas', '#'.repeat(20000)],
    ['listas aninhadas', '- a\n'.repeat(5000)],
    ['marcadores de idioma', '<!-- en -->\nx\n'.repeat(1500)],
  ];

  test.each(inputs)('%s em menos de 100 ms', (_name, input) => {
    const started = performance.now();
    const blocks = parseReleaseMarkdown(input);
    selectReleaseNotes(input, 'en');
    parseInline(input);
    const elapsed = performance.now() - started;
    expect(blocks).toBeDefined();
    expect(elapsed).toBeLessThan(100);
  });
});
