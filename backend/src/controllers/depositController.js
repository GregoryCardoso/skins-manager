const depositService = require('../services/depositService');

function list(req, res) {
  res.json({ success: true, data: depositService.listDeposits() });
}

function create(req, res) {
  const data = depositService.createDeposit(req.body, { now: req.app.locals.now() });
  res.status(201).json({ success: true, data });
}

function update(req, res) {
  const data = depositService.updateDeposit(req.params.id, req.body, { now: req.app.locals.now() });
  res.json({ success: true, data });
}

function remove(req, res) {
  res.json({ success: true, data: depositService.deleteDeposit(req.params.id, { now: req.app.locals.now() }) });
}

module.exports = { list, create, update, remove };
