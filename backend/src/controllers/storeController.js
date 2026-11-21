const storeService = require('../services/storeService');

function list(req, res) {
  res.json({ success: true, data: storeService.listStores(req.validatedQuery) });
}

function getById(req, res) {
  res.json({ success: true, data: storeService.getStore(req.params.id) });
}

function create(req, res) {
  const data = storeService.createStore(req.body, { now: req.app.locals.now() });
  res.status(201).json({ success: true, data });
}

function update(req, res) {
  const data = storeService.updateStore(req.params.id, req.body, { now: req.app.locals.now() });
  res.json({ success: true, data });
}

function remove(req, res) {
  res.json({ success: true, data: storeService.deleteStore(req.params.id) });
}

function saleQuote(req, res) {
  res.json({ success: true, data: storeService.quoteSale(req.params.id, req.validatedQuery.salePriceCents) });
}

module.exports = { list, getById, create, update, remove, saleQuote };
