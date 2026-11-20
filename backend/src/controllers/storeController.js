const storeService = require('../services/storeService');

function list(req, res) {
  res.json({ success: true, data: storeService.listStores(req.validatedQuery) });
}

function saleQuote(req, res) {
  res.json({ success: true, data: storeService.quoteSale(req.params.id, req.validatedQuery.salePriceCents) });
}

module.exports = { list, saleQuote };
