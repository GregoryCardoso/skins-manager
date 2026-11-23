'use strict';

// Controller fino das importações (D318): valida a forma (middlewares), chama o service e formata a resposta.
const importService = require('../services/imports/importService');

const ok = (res, data) => res.json({ success: true, data });

async function run(req, res) {
  const { trigger, cutoffAt, fullScan } = req.body;
  const data = await importService.runImport({
    trigger,
    cutoffAt: cutoffAt ?? undefined,
    fullScan: fullScan === true,
    fetchFn: req.app.locals.fetchFn,
    sleepFn: req.app.locals.sleepFn,
    now: req.app.locals.now(),
  });
  ok(res, data);
}

function listBatches(req, res) {
  ok(res, importService.listBatches(req.importQuery));
}

function getBatch(req, res) {
  ok(res, importService.getBatchView(req.params.id));
}

function undoPreview(req, res) {
  ok(res, importService.getUndoPreview(req.params.id));
}

function undo(req, res) {
  ok(res, importService.undoBatch(req.params.id, { confirmWarnings: req.body.confirmWarnings === true, now: req.app.locals.now() }));
}

function listEntries(req, res) {
  ok(res, importService.listOpenEntries());
}

module.exports = { run, listBatches, getBatch, undoPreview, undo, listEntries };
