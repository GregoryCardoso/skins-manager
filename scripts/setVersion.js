'use strict';

// Atualiza a versão nos quatro package.json (raiz, backend, frontend, desktop) sem reformatá-los:
// só o valor do primeiro campo "version" de cada arquivo muda (indentação, quebras de linha e ordem ficam).
// Uso: npm run version:set -- 1.2.3
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const PACKAGE_DIRS = ['.', 'backend', 'frontend', 'desktop'];

// semver estrito: MAJOR.MINOR.PATCH, sem zeros à esquerda, sem prefixo "v" nem sufixos.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function packageFiles(rootDir = ROOT_DIR) {
  return PACKAGE_DIRS.map((dir) => path.join(rootDir, dir, 'package.json'));
}

function setVersion(version, { rootDir = ROOT_DIR } = {}) {
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    throw new Error(`Versão inválida: "${version}". Use o formato x.y.z (por exemplo, 1.2.3).`);
  }
  const files = packageFiles(rootDir);
  // Lê e valida tudo antes de gravar, para nunca deixar os arquivos com versões diferentes.
  const updated = files.map((file) => {
    const text = fs.readFileSync(file, 'utf8');
    const pattern = /("version"\s*:\s*")[^"]*(")/;
    if (!pattern.test(text)) throw new Error(`${file} não tem o campo "version".`);
    return { file, text: text.replace(pattern, `$1${version}$2`) };
  });
  for (const { file, text } of updated) fs.writeFileSync(file, text);
  return files;
}

if (require.main === module) {
  try {
    const files = setVersion(process.argv[2]);
    console.log(`Versão ${process.argv[2]} gravada em:\n${files.map((f) => `  ${f}`).join('\n')}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { setVersion, packageFiles, SEMVER };
