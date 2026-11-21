const withdrawalService = require('../services/withdrawalService');

function list(req, res) {
  res.json({ success: true, data: withdrawalService.listWithdrawals() });
}

function feeSuggestion(req, res) {
  res.json({ success: true, data: withdrawalService.getFeeSuggestion(req.validatedQuery) });
}

function create(req, res) {
  const data = withdrawalService.createWithdrawal(req.body, { now: req.app.locals.now() });
  res.status(201).json({ success: true, data });
}

function update(req, res) {
  const data = withdrawalService.updateWithdrawal(req.params.id, req.body, { now: req.app.locals.now() });
  res.json({ success: true, data });
}

function remove(req, res) {
  res.json({ success: true, data: withdrawalService.deleteWithdrawal(req.params.id) });
}

module.exports = { list, feeSuggestion, create, update, remove };
