'use strict';

// T25 (D153): as classes de erro exigem código, e nenhum `new *Error('...')` em src/ ou nos testes omite o código.
const fs = require('fs');
const path = require('path');
const { ValidationError, NotFoundError, ConflictError, UpstreamError } = require('../../src/errors/AppError');

const BACKSLASH = String.fromCharCode(92);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

// Linhas de chamadas `new XError(...)` com menos de dois argumentos no nível de topo.
function callsWithoutCode(source) {
  const found = [];
  const re = /new (Validation|NotFound|Conflict|Upstream)Error\(/g;
  let match;
  while ((match = re.exec(source))) {
    let depth = 1;
    let commas = 0;
    let quote = null;
    for (let i = re.lastIndex; i < source.length && depth > 0; i += 1) {
      const c = source[i];
      if (quote) {
        if (c === BACKSLASH) i += 1;
        else if (c === quote) quote = null;
      } else if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') depth -= 1;
      else if (c === ',' && depth === 1) commas += 1;
    }
    if (commas < 1) found.push(source.slice(0, match.index).split('\n').length);
  }
  return found;
}

describe('T25: código de erro obrigatório', () => {
  test.each([ValidationError, NotFoundError, ConflictError, UpstreamError])('%p sem código lança Error de programação', (Cls) => {
    expect(() => new Cls('msg')).toThrow(/exige um código/);
    expect(() => new Cls('msg', '')).toThrow(/exige um código/);
    expect(() => new Cls('msg', 42)).toThrow(/exige um código/);
    expect(() => new Cls('msg', 'ALGUM_CODIGO')).not.toThrow();
  });

  test('nenhum arquivo de src/ cria erro sem código', () => {
    const files = walk(path.join(__dirname, '..', '..', 'src')).filter((f) => f.endsWith('.js'));
    const offenders = [];
    for (const file of files) {
      for (const line of callsWithoutCode(fs.readFileSync(file, 'utf8'))) offenders.push(`${path.relative(process.cwd(), file)}:${line}`);
    }
    expect(offenders).toEqual([]);
  });
});
