const fs = require('fs');
const path = require('path');
const { MAX_NOTES_CHARS } = require('../src/lib/updatePolicy');

// Notas da v2.0.0 (D370, I1): o app corta o corpo em MAX_NOTES_CHARS antes de escolher o idioma;
// por isso o arquivo inteiro (13 idiomas) precisa caber com margem. `docs/` é ignorado pelo git:
// sem o arquivo (clone limpo, CI), o teste é pulado.
const NOTES_FILE = path.join(__dirname, '..', '..', 'docs', 'notas-v2.0.0.md');
const MAX_SAFE_CHARS = 19000;
const maybe = fs.existsSync(NOTES_FILE) ? test : test.skip;

describe('tamanho das notas da v2.0.0', () => {
  test('o limite do app continua em 20 000', () => {
    expect(MAX_NOTES_CHARS).toBe(20000);
  });

  maybe(`docs/notas-v2.0.0.md tem no máximo ${MAX_SAFE_CHARS} caracteres`, () => {
    const text = fs.readFileSync(NOTES_FILE, 'utf8');
    expect(text.length).toBeLessThanOrEqual(MAX_SAFE_CHARS);
  });
});
