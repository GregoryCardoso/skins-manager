const fs = require('fs');
const backupService = require('../services/backupService');

// GET /api/backup/export (D150): envia o arquivo e apaga o temporário ao fim, mesmo se o cliente abortar.
function exportBackup(req, res, next) {
  let exported;
  try {
    exported = backupService.createExport({ now: req.app.locals.now() });
  } catch (err) {
    return next(err);
  }
  const { filePath, fileName, contentType, sizeBytes, cleanup, release } = exported;
  const stream = fs.createReadStream(filePath);
  // O 'close' do stream vem depois do fim normal e da destruição; só então o Windows libera o arquivo.
  stream.once('close', cleanup);
  stream.on('error', (err) => {
    console.error(`Falha ao enviar o backup: ${err && err.message ? err.message : err}`);
    res.destroy(err);
  });
  res.once('close', () => stream.destroy());
  // A trava da exportação solta assim que a resposta termina de ser enviada, sem esperar o 'close' do stream (que só vem depois):
  // quem exporta e em seguida importa não recebe BACKUP_BUSY por uma corrida de milissegundos. O arquivo continua sendo apagado no 'close'.
  if (typeof release === 'function') res.once('finish', release);
  res.status(200);
  res.set({
    'Content-Type': contentType,
    'Content-Length': String(sizeBytes),
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'no-store',
  });
  stream.pipe(res);
  return undefined;
}

// POST /api/backup/import (D151): `req.body` é um Buffer.
function importBackup(req, res) {
  const data = backupService.importBackup(req.body, { now: req.app.locals.now() });
  res.json({ success: true, data });
}

// POST /api/backup/import-preview (12.8): `req.body` é um Buffer; só lê e resume, nada é gravado.
function importPreview(req, res) {
  res.json({ success: true, data: backupService.previewBackup(req.body) });
}

// GET /api/backup/info (D175).
function info(req, res) {
  res.json({ success: true, data: backupService.getBackupInfo({ canOpenFn: req.app.locals.canOpenFolderFn }) });
}

// POST /api/backup/open-folder (D175): abre só a pasta de backups; nenhum caminho vem do cliente.
async function openFolder(req, res, next) {
  try {
    const data = await backupService.openBackupsFolder({
      openFolderFn: req.app.locals.openFolderFn,
      canOpenFn: req.app.locals.canOpenFolderFn,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = { exportBackup, importBackup, importPreview, info, openFolder };
