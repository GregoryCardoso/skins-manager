// Ferramenta de apoio só de desenvolvimento (D369, 11.1): lista, por idioma, as chaves que faltam, as que sobram, os marcadores
// {x} diferentes e os textos iguais ao inglês (possível texto sem traduzir). Compara cada `src/i18n/<idioma>.json` com o `en.json`
// (a base). Não grava nada e não faz parte dos testes (o teste que vale é `i18n.languages.parity.test.ts`).
//
// Uso (na pasta frontend):  node scripts/i18n-report.mjs            todos os idiomas
//                           node scripts/i18n-report.mjs pt-BR ru   só os idiomas informados
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n');
const CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

const read = (code) => JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8'));
const isPlural = (node) =>
  node !== null && typeof node === 'object' && 'other' in node && Object.keys(node).every((key) => CATEGORIES.includes(key));

function flatten(node, prefix = '', out = { texts: {}, plurals: {} }) {
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.texts[full] = value;
    else if (isPlural(value)) out.plurals[full] = value;
    else flatten(value, full, out);
  }
  return out;
}

const markers = (text) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort().join(',');

function requiredCategories(locale) {
  const rules = new Intl.PluralRules(locale);
  const found = new Set(['other']);
  for (let n = 0; n <= 1200; n += 1) found.add(rules.select(n));
  return [...found];
}

const available = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5));
const wanted = process.argv.slice(2);
const codes = (wanted.length > 0 ? wanted : available).filter((code) => code !== 'en');
const base = flatten(read('en'));
let problems = 0;

for (const code of codes) {
  if (!available.includes(code)) {
    console.log(`\n== ${code}: arquivo ${code}.json não existe`);
    problems += 1;
    continue;
  }
  const own = flatten(read(code));
  const missing = Object.keys(base.texts).filter((key) => !(key in own.texts));
  const extra = Object.keys(own.texts).filter((key) => !(key in base.texts));
  const markerDiff = Object.keys(base.texts).filter((key) => key in own.texts && markers(own.texts[key]) !== markers(base.texts[key]));
  const empty = Object.keys(own.texts).filter((key) => own.texts[key].trim() === '');
  const same = Object.keys(base.texts).filter((key) => own.texts[key] === base.texts[key] && /[A-Za-z]{3}/.test(base.texts[key]));
  const required = requiredCategories(code);
  const pluralMissing = Object.keys(base.plurals).flatMap((key) =>
    !(key in own.plurals) ? [`${key} (nó inteiro)`] : required.filter((category) => !(category in own.plurals[key])).map((category) => `${key}.${category}`),
  );
  const pluralExtra = Object.keys(own.plurals).filter((key) => !(key in base.plurals));
  const groups = [
    ['faltando', [...missing, ...pluralMissing]],
    ['sobrando', [...extra, ...pluralExtra]],
    ['marcadores {x} diferentes', markerDiff],
    ['texto vazio', empty],
    ['igual ao inglês (conferir se falta traduzir)', same],
  ];
  const total = groups.slice(0, 4).reduce((sum, [, list]) => sum + list.length, 0);
  problems += total;
  console.log(`\n== ${code}: ${Object.keys(own.texts).length} textos e ${Object.keys(own.plurals).length} plurais (base: ${Object.keys(base.texts).length} e ${Object.keys(base.plurals).length})`);
  for (const [title, list] of groups) {
    if (list.length === 0) continue;
    console.log(`  ${title}: ${list.length}`);
    for (const key of list.slice(0, 40)) console.log(`    ${key}`);
    if (list.length > 40) console.log(`    ... e mais ${list.length - 40}`);
  }
}

console.log(problems === 0 ? '\nNenhum problema de chaves.' : `\n${problems} problema(s) de chaves.`);
process.exitCode = problems === 0 ? 0 : 1;
