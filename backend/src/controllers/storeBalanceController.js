const storeBalanceService = require('../services/storeBalanceService');

function list(req, res) {
  res.json({ success: true, data: storeBalanceService.listHistory(req.validatedQuery) });
}

function current(req, res) {
  res.json({ success: true, data: storeBalanceService.listCurrent({ now: req.app.locals.now() }) });
}

function checkPreview(req, res) {
  res.json({ success: true, data: storeBalanceService.previewCheck(req.validatedQuery, { now: req.app.locals.now() }) });
}

function createCheck(req, res) {
  const data = storeBalanceService.createCheck(req.body, { now: req.app.locals.now() });
  res.status(201).json({ success: true, data });
}

function remove(req, res) {
  res.json({ success: true, data: storeBalanceService.deleteEntry(req.params.id) });
}

module.exports = { list, current, checkPreview, createCheck, remove };
