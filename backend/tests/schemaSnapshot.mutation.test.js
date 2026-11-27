'use strict';

// QA do S3: prova que schemaSnapshot.test.js REPROVA quando uma migração publicada muda ou o esquema diverge. Nenhum arquivo real é
// editado: roda o jest num processo filho, com um setupFile temporário que simula a mudança (fs.readFileSync de uma migração ou um
// ALTER TABLE depois das migrações). Também confere que o CRLF não muda o hash e que o index.js fica fora dos hashes.
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BACKEND = path.join(__dirname, '..');
const JEST_BIN = path.join(BACKEND, 'node_modules', 'jest', 'bin', 'jest.js');
const SNAPSHOT = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'schema.snapshot.json'), 'utf8'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-mutation-'));

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

function runChild(mutatorSource) {
  const mutator = path.join(TMP, `mutator-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(mutator, mutatorSource);
  const result = spawnSync(
    process.execPath,
    [JEST_BIN, 'tests/schemaSnapshot.test.js', '--setupFiles', path.join(BACKEND, 'tests', 'setup.js'), mutator, '--coverage=false', '--maxWorkers=1'],
    { cwd: BACKEND, encoding: 'utf8', env: { ...process.env, UPDATE_SCHEMA_SNAPSHOT: '' } },
  );
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

const patchRead = (match, transform) => `
const fs = require('fs');
const original = fs.readFileSync;
fs.readFileSync = function (file, ...rest) {
  const data = original.call(this, file, ...rest);
  if (typeof file === 'string' && ${match}.test(file.replace(/\\\\/g, '/')) && typeof data === 'string') return (${transform})(data);
  return data;
};
`;

describe('schemaSnapshot.test.js reprova mudanças (processo filho)', () => {
  jest.setTimeout(120000);

  test('controle: sem mutação, passa', () => {
    const { status, output } = runChild('// nada');
    expect({ status, tail: status === 0 ? '' : output }).toEqual({ status: 0, tail: '' });
  });

  test('migração publicada editada (um byte a mais): reprova e aponta o arquivo', () => {
    const { status, output } = runChild(patchRead('/migrations\\/v001_initial\\.js$/', "(s) => s + '\\n// editada'"));
    expect(status).not.toBe(0);
    expect(output).toMatch(/v001_initial\.js/);
    expect(output).toMatch(/edited/);
  });

  test('mudar só o fim de linha (CRLF) NÃO reprova', () => {
    const { status, output } = runChild(patchRead('/migrations\\/v002_catalog\\.js$/', "(s) => s.replace(/\\n/g, '\\r\\n')"));
    expect({ status, tail: status === 0 ? '' : output }).toEqual({ status: 0, tail: '' });
  });

  test('esquema divergente (coluna extra depois das migrações): reprova no teste de tabelas', () => {
    const { status, output } = runChild(`
      const db = require('${path.join(BACKEND, 'src', 'config', 'database').replace(/\\/g, '/')}');
      const original = db.getDb;
      db.getDb = function (...args) {
        const conn = original.apply(this, args);
        try { conn.exec('ALTER TABLE items ADD COLUMN qa_extra TEXT'); } catch (e) { /* ja existe nesta conexao */ }
        return conn;
      };
    `);
    expect(status).not.toBe(0);
    expect(output).toMatch(/qa_extra/);
  });
});

describe('snapshot: conteúdo', () => {
  test('os hashes cobrem só vNNN_*.js (index.js fora) e batem com o arquivo real', () => {
    const names = Object.keys(SNAPSHOT.migrations);
    expect(names.length).toBeGreaterThanOrEqual(27);
    expect(names.every((n) => /^v\d{3}_.+\.js$/.test(n))).toBe(true);
    expect(names).not.toContain('index.js');
    const real = fs.readdirSync(path.join(BACKEND, 'src', 'config', 'migrations')).filter((n) => /^v\d{3}_/.test(n)).sort();
    expect(names.sort()).toEqual(real);
    const text = fs.readFileSync(path.join(BACKEND, 'src', 'config', 'migrations', names[0]), 'utf8').replace(/\r\n/g, '\n');
    expect(crypto.createHash('sha256').update(text).digest('hex')).toBe(SNAPSHOT.migrations[names[0]]);
  });

  test('o snapshot não guarda objetos internos sqlite_* nem a tabela de dados do usuário', () => {
    expect(SNAPSHOT.objects.some((o) => /^sqlite_/.test(o.name))).toBe(false);
    expect(SNAPSHOT.userVersion).toBe(names().length);
  });
});

function names() {
  return Object.keys(SNAPSHOT.migrations);
}
