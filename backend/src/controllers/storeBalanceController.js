const storeBalanceService = require('../services/storeBalanceService');

function list(req, res) {
  res.json({ success: true, data: storeBalanceService.listHistory(req.validatedQuery) });
}

function current(req, res) {
  res.json({ success: true, data: storeBalanceService.listCurrent({ now: req.app.locals.now() }) });
}

function create(req, res) {
  const data = storeBalanceService.createStoreBalance(req.body, { now: req.app.locals.now() });
  res.status(201).json({ success: true, data });
}

function remove(req, res) {
  res.json({ success: true, data: storeBalanceService.deleteStoreBalance(req.params.id) });
}

module.exports = { list, current, create, remove };
