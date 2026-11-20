const storeService = require('../services/storeService');

function list(req, res) {
  res.json({ success: true, data: storeService.listStores(req.validatedQuery) });
}

module.exports = { list };
