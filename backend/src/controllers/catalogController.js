const catalogService = require('../services/catalogService');

const ok = (res, data) => res.json({ success: true, data });

function search(req, res) {
  ok(res, catalogService.searchCatalog(req.validatedQuery));
}

function status(req, res) {
  ok(res, catalogService.getCatalogStatus());
}

function getById(req, res) {
  ok(res, catalogService.getCatalogItemOrFail(req.params.id));
}

async function refresh(req, res) {
  const data = await catalogService.refreshCatalog({ fetchFn: req.app.locals.fetchFn, now: req.app.locals.now() });
  ok(res, data);
}

module.exports = { search, status, getById, refresh };
