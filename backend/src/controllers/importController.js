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

function cutoffPreview(req, res) {
  ok(res, importService.previewCutoffChange({ cutoffAt: req.importQuery.cutoffAt, target: req.importQuery.target, now: req.app.locals.now() }));
}

async function changeCutoff(req, res) {
  const data = await importService.changeCutoff({
    cutoffAt: req.body.cutoffAt,
    confirm: req.body.confirm,
    target: req.body.target ?? 'TRADES',
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
  ok(res, req.importQuery && req.importQuery.ignored ? importService.listIgnoredEntries() : importService.listOpenEntries());
}

function resolveEntry(req, res) {
  const { action, targetId, purchase, confirmWarnings, purchaseOnly, acquiredAt } = req.body;
  ok(res, importService.resolveEntry(
    req.params.id,
    {
      action, targetId: targetId ?? null, purchase, confirmWarnings: confirmWarnings === true, purchaseOnly: purchaseOnly === true,
      acquiredAt: acquiredAt ?? null,
    },
    { now: req.app.locals.now() }
  ));
}

function reopenEntry(req, res) {
  ok(res, importService.reopenEntry(req.params.id, { now: req.app.locals.now() }));
}

function bulkResolve(req, res) {
  const { action, entryIds, acquiredAt } = req.body;
  ok(res, importService.bulkResolveEntries({ action, entryIds, acquiredAt: acquiredAt ?? null }, { now: req.app.locals.now() }));
}

module.exports = { run, cutoffPreview, changeCutoff, listBatches, getBatch, undoPreview, undo, listEntries, resolveEntry, reopenEntry, bulkResolve };
