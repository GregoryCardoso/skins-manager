'use strict';

// Atualiza a versão nos quatro package.json (raiz, backend, frontend, desktop) sem reformatá-los:
// só o valor do primeiro campo "version" de cada arquivo muda (indentação, quebras de linha e ordem ficam).
// Os package-lock.json correspondentes (se existirem) também: o "version" da raiz e o de packages[""].
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

function lockFiles(rootDir = ROOT_DIR) {
  return PACKAGE_DIRS.map((dir) => path.join(rootDir, dir, 'package-lock.json'));
}

// Troca só o valor do "version" da raiz do lock e o de packages[""]; o resto do texto fica intacto.
function updateLockText(text, version) {
  const rootPattern = /("version"\s*:\s*")[^"]*(")/;
  let result = text.replace(rootPattern, `$1${version}$2`);
  // Só dentro do objeto packages[""] (até o primeiro "}"): se ele não tiver "version", nada muda,
  // em vez de trocar a versão de uma dependência.
  const pkgMatch = /"packages"\s*:\s*\{\s*"":\s*\{/.exec(result);
  if (pkgMatch) {
    const blockStart = pkgMatch.index + pkgMatch[0].length;
    const blockEnd = result.indexOf('}', blockStart);
    if (blockEnd !== -1) {
      const block = result.slice(blockStart, blockEnd).replace(rootPattern, `$1${version}$2`);
      result = result.slice(0, blockStart) + block + result.slice(blockEnd);
    }
  }
  return result;
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
  // package-lock.json: opcional (pode não existir numa pasta); lido antes de gravar qualquer coisa.
  for (const lock of lockFiles(rootDir)) {
    if (!fs.existsSync(lock)) continue;
    updated.push({ file: lock, text: updateLockText(fs.readFileSync(lock, 'utf8'), version) });
  }
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

module.exports = { setVersion, packageFiles, lockFiles, updateLockText, SEMVER };
