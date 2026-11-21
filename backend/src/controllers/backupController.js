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
  const { filePath, fileName, contentType, sizeBytes, cleanup } = exported;
  const stream = fs.createReadStream(filePath);
  // O 'close' do stream vem depois do fim normal e da destruição; só então o Windows libera o arquivo.
  stream.once('close', cleanup);
  stream.on('error', (err) => {
    console.error(`Falha ao enviar o backup: ${err && err.message ? err.message : err}`);
    res.destroy(err);
  });
  res.once('close', () => stream.destroy());
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

module.exports = { exportBackup, importBackup };
