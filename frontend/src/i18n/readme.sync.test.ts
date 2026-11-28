import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { LANGUAGE_REGISTRY } from './languages';

// Sincronia dos 13 READMEs (Etapa 13, D375): `README.md` (en, na raiz) e `readme/README.<código>.md` (os outros 12). Lidos como texto;
// nada de banco nem de rede. A renderização no GitHub (Mermaid, <picture>, badges) não se prova aqui.
//
// Fase das traduções (13.2 a 13.5): enquanto os lotes não chegam, só en e pt-BR existem. Os códigos em PENDING_TRANSLATIONS podem ficar
// sem arquivo. Cada lote REMOVE os seus códigos desta lista ao criar os arquivos (o teste "a lista de pendentes só tem arquivos que
// ainda faltam" falha se um pendente já tiver arquivo). Ao fim da 13.5 a lista fica vazia e a regra "um arquivo por idioma" vale inteira.
// A linha de idiomas (linha 1) já traz os 13 links desde a 13.2, mesmo para arquivos que ainda não existem.
const PENDING_TRANSLATIONS: readonly string[] = ['de', 'es', 'fr', 'it', 'pl', 'tr', 'ru', 'uk', 'ja', 'zh-CN', 'ko'];

const root = path.join(__dirname, '..', '..', '..');
const readmeDir = path.join(root, 'readme');
const MAX_PNG_BYTES = 600 * 1024;
const MAX_GIF_BYTES = 5 * 1024 * 1024;

function fileOf(code: string): string {
  return code === 'en' ? path.join(root, 'README.md') : path.join(readmeDir, `README.${code}.md`);
}

function relativeFileOf(fromCode: string, toCode: string): string {
  if (fromCode === 'en') return toCode === 'en' ? 'README.md' : `readme/README.${toCode}.md`;
  return toCode === 'en' ? '../README.md' : `README.${toCode}.md`;
}

function expectedLanguageLine(code: string): string {
  return LANGUAGE_REGISTRY.map((entry) =>
    entry.code === code ? `**${entry.nativeName}**` : `[${entry.nativeName}](${relativeFileOf(code, entry.code)})`,
  ).join(' · ');
}

const existing = LANGUAGE_REGISTRY.filter((entry) => fs.existsSync(fileOf(entry.code))).map((entry) => entry.code as string);

interface Parsed {
  code: string;
  raw: string;
  firstLine: string;
  // Texto sem comentários HTML e sem a linha 1 (a linha de idiomas é conferida à parte).
  body: string;
  // O mesmo, sem blocos de código cercados.
  bodyNoCode: string;
}

function parse(code: string): Parsed {
  const raw = fs.readFileSync(fileOf(code), 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const body = lines.slice(1).join('\n').replace(/<!--[\s\S]*?-->/g, '');
  const bodyNoCode = body.replace(/```[\s\S]*?```/g, '');
  return { code, raw, firstLine: lines[0], body, bodyNoCode };
}

const parsed = existing.map(parse);
const base = parsed.find((p) => p.code === 'en');

function isRemote(ref: string): boolean {
  return /^(https?:|mailto:|#|data:)/i.test(ref);
}

function anchors(p: Parsed): string[] {
  return [...p.bodyNoCode.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1]);
}

// Todas as referências a arquivos: <img src>, <source srcset> e ![](...).
function imageRefs(p: Parsed): string[] {
  const refs = [
    ...[...p.bodyNoCode.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/g)].map((m) => m[1]),
    ...[...p.bodyNoCode.matchAll(/<source\b[^>]*?\bsrcset="([^"]+)"/g)].map((m) => m[1]),
    ...[...p.bodyNoCode.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]),
  ];
  return refs.filter((ref) => !isRemote(ref));
}

function linkRefs(p: Parsed): string[] {
  const refs = [
    ...[...p.bodyNoCode.matchAll(/\bhref="([^"]+)"/g)].map((m) => m[1]),
    ...[...p.bodyNoCode.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]),
  ];
  return refs.filter((ref) => !isRemote(ref));
}

const base_ = (ref: string) => path.basename(ref.split('#')[0]);
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

describe('README: um arquivo por idioma', () => {
  test('o README.md (en) e o de pt-BR existem', () => {
    expect(existing).toContain('en');
    expect(existing).toContain('pt-BR');
  });

  test('só faltam arquivos dos idiomas ainda pendentes (e todos os outros existem)', () => {
    const missing = LANGUAGE_REGISTRY.map((e) => e.code as string).filter((code) => !existing.includes(code));
    expect(missing.filter((code) => !PENDING_TRANSLATIONS.includes(code))).toEqual([]);
  });

  test('a lista de pendentes só tem arquivos que ainda faltam (remova da lista o idioma cujo arquivo foi criado)', () => {
    expect(PENDING_TRANSLATIONS.filter((code) => existing.includes(code))).toEqual([]);
    const codes = LANGUAGE_REGISTRY.map((e) => e.code as string);
    expect(PENDING_TRANSLATIONS.filter((code) => !codes.includes(code))).toEqual([]);
  });

  test('nenhum README.*.md fora do registro, na raiz ou em readme/', () => {
    const allowed = new Set(LANGUAGE_REGISTRY.map((e) => `README.${e.code}.md`));
    const inReadmeDir = fs.existsSync(readmeDir) ? fs.readdirSync(readmeDir) : [];
    const stray = inReadmeDir.filter((name) => /^README\..+\.md$/i.test(name) && !allowed.has(name));
    expect(stray).toEqual([]);
    const strayRoot = fs.readdirSync(root).filter((name) => /^README\..+\.md$/i.test(name));
    expect(strayRoot).toEqual([]);
  });
});

describe('README: linha de idiomas', () => {
  test.each(existing)('a linha 1 de %s é exatamente a esperada (ordem do registro, atual em negrito sem link)', (code) => {
    const p = parsed.find((x) => x.code === code) as Parsed;
    expect(p.firstLine).toBe(expectedLanguageLine(code));
  });
});

describe('README: mesma estrutura em todos os arquivos', () => {
  test.each(existing.filter((c) => c !== 'en'))('%s tem as mesmas âncoras, na mesma ordem, que o inglês', (code) => {
    const p = parsed.find((x) => x.code === code) as Parsed;
    expect(anchors(p)).toEqual(anchors(base as Parsed));
  });

  test('o índice do inglês aponta só para âncoras que existem', () => {
    const b = base as Parsed;
    const ids = new Set(anchors(b));
    const targets = [...b.bodyNoCode.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((t) => !ids.has(t))).toEqual([]);
    for (const p of parsed) {
      const own = new Set(anchors(p));
      const t = [...p.bodyNoCode.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
      expect(t.filter((x) => !own.has(x))).toEqual([]);
    }
  });

  test.each(existing.filter((c) => c !== 'en'))('%s referencia as mesmas imagens (pelo nome do arquivo), na mesma ordem', (code) => {
    const p = parsed.find((x) => x.code === code) as Parsed;
    expect(imageRefs(p).map(base_)).toEqual(imageRefs(base as Parsed).map(base_));
  });

  test.each(existing.filter((c) => c !== 'en'))('%s tem o mesmo número de <details>, blocos mermaid, <picture> e badges', (code) => {
    const p = parsed.find((x) => x.code === code) as Parsed;
    const b = base as Parsed;
    expect(count(p.bodyNoCode, /<details>/g)).toBe(count(b.bodyNoCode, /<details>/g));
    expect(count(p.bodyNoCode, /<\/details>/g)).toBe(count(b.bodyNoCode, /<\/details>/g));
    expect(count(p.body, /```mermaid/g)).toBe(count(b.body, /```mermaid/g));
    expect(count(p.bodyNoCode, /<picture>/g)).toBe(count(b.bodyNoCode, /<picture>/g));
    expect(count(p.bodyNoCode, /img\.shields\.io/g)).toBe(count(b.bodyNoCode, /img\.shields\.io/g));
  });

  test('o inglês tem a estrutura esperada (2 <details>, 1 Mermaid, 1 <picture>, badges, âncoras do plano)', () => {
    const b = base as Parsed;
    expect(count(b.bodyNoCode, /<details>/g)).toBe(2);
    expect(count(b.body, /```mermaid/g)).toBe(1);
    expect(count(b.bodyNoCode, /<picture>/g)).toBe(1);
    expect(count(b.bodyNoCode, /img\.shields\.io/g)).toBeGreaterThanOrEqual(4);
    expect(anchors(b)).toEqual([
      'contents', 'about', 'features', 'screens', 'install', 'updates', 'data', 'feedback', 'development', 'architecture', 'credits', 'license',
    ]);
  });
});

describe('README: links, imagens e tamanho', () => {
  test.each(existing)('%s: todo link e imagem relativos apontam para um arquivo que existe', (code) => {
    const p = parsed.find((x) => x.code === code) as Parsed;
    const dir = path.dirname(fileOf(code));
    const refs = [...imageRefs(p), ...linkRefs(p)];
    const broken = refs.filter((ref) => !fs.existsSync(path.resolve(dir, decodeURIComponent(ref.split('#')[0]))));
    expect(broken).toEqual([]);
  });

  test.each(existing)('%s: PNG até 600 KB e GIF até 5 MB', (code) => {
    const p = parsed.find((x) => x.code === code) as Parsed;
    const dir = path.dirname(fileOf(code));
    for (const ref of imageRefs(p)) {
      const file = path.resolve(dir, ref);
      if (!fs.existsSync(file)) continue;
      const size = fs.statSync(file).size;
      if (/\.png$/i.test(file)) expect({ ref, ok: size <= MAX_PNG_BYTES }).toEqual({ ref, ok: true });
      if (/\.gif$/i.test(file)) expect({ ref, ok: size <= MAX_GIF_BYTES }).toEqual({ ref, ok: true });
    }
  });

  test('todos os prints de assets/screenshots são usados pelo inglês', () => {
    const dir = path.join(root, 'assets', 'screenshots');
    const used = new Set(imageRefs(base as Parsed).map(base_));
    const files = fs.readdirSync(dir).filter((name) => /\.(png|gif)$/i.test(name));
    expect(files.filter((name) => !used.has(name))).toEqual([]);
  });
});

describe('README: conteúdo que não pode aparecer', () => {
  test.each(existing)('%s: sem caminho pessoal, e-mail, texto de pasta antiga, badge de downloads ou outras plataformas', (code) => {
    const p = parsed.find((x) => x.code === code) as Parsed;
    const text = p.raw;
    // "C:\Users\<seu usuário>" (exemplo com placeholder) pode; um nome real não.
    expect(text.match(/C:\\Users\\(?!<)[^\\\s`]+/g) ?? []).toEqual([]);
    expect(text.match(/C:\/Users\/(?!<)[^/\s`]+/g) ?? []).toEqual([]);
    expect(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g) ?? []).toEqual([]);
    expect(text).not.toMatch(/cs-inventory-app/);
    expect(text).not.toMatch(/shields\.io\/github\/downloads/);
    // D377: só Windows.
    expect(text).not.toMatch(/\b(Linux|macOS|Mac OS|Ubuntu)\b/i);
  });
});
