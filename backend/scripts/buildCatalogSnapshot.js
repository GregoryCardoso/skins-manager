'use strict';

// Gera backend/data/seed/catalog.json a partir da CSGO-API (D81). Rodar manualmente, com internet:
//   npm run catalog:snapshot            (dentro de backend/ ou na raiz)
// Nunca roda nos testes. Grava em arquivo temporário e renomeia (não deixa arquivo pela metade).
const fs = require('fs');
const path = require('path');
const { CATALOG_SNAPSHOT_PATH } = require('../src/config/constants');
const { downloadCatalog, serializeSnapshot, parseSnapshot } = require('../src/services/catalogService');

async function main() {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : CATALOG_SNAPSHOT_PATH;
  console.log('Baixando o catálogo da CSGO-API (pode levar alguns segundos)...');
  const { rows, skipped } = await downloadCatalog({ fetchFn: globalThis.fetch });

  const text = serializeSnapshot(rows, { now: new Date() });
  parseSnapshot(text); // garante que o arquivo gerado é aceito pelo importador

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, target);

  const mb = (Buffer.byteLength(text) / (1024 * 1024)).toFixed(2);
  console.log(`Snapshot gravado em ${target}`);
  console.log(`${rows.length} itens (${skipped} entradas ignoradas), ${mb} MB.`);
}

main().catch((err) => {
  console.error(`Falha ao gerar o snapshot: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
