const itemOperationService = require('../services/operations/itemOperationService');

const ctx = (req) => ({ now: req.app.locals.now() });
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

function candidates(req, res) {
  ok(res, itemOperationService.candidates(req.params.id, ctx(req)));
}

function apply(req, res) {
  ok(res, itemOperationService.applyComponent(req.params.id, req.body, ctx(req)), 201);
}

function scrapeOff(req, res) {
  ok(res, itemOperationService.scrapeComponent(req.params.id, req.params.componentId, req.body, ctx(req)));
}

function openOptions(req, res) {
  ok(res, itemOperationService.openOptions(req.params.id, ctx(req)));
}

function open(req, res) {
  ok(res, itemOperationService.openContainer(req.params.id, req.body, ctx(req)), 201);
}

function listForItem(req, res) {
  ok(res, itemOperationService.listForItem(req.params.id));
}

function undo(req, res) {
  ok(res, itemOperationService.undo(req.params.id, ctx(req)));
}

module.exports = { openOptions, open, candidates, apply, scrapeOff, listForItem, undo };
