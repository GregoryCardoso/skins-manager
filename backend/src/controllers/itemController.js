const itemService = require('../services/itemService');

const ctx = (req) => ({ now: req.app.locals.now() });
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

function list(req, res) {
  ok(res, itemService.listItems(req.validatedQuery, ctx(req)));
}

function groups(req, res) {
  ok(res, itemService.listItemGroups(req.validatedQuery, ctx(req)));
}

function sales(req, res) {
  ok(res, itemService.listSales(req.validatedQuery, ctx(req)));
}

function stats(req, res) {
  ok(res, itemService.getItemStats(req.validatedQuery));
}

function getById(req, res) {
  ok(res, itemService.getItem(req.params.id, ctx(req)));
}

function create(req, res) {
  ok(res, itemService.createItem(req.body, ctx(req)), 201);
}

function update(req, res) {
  ok(res, itemService.updateItem(req.params.id, req.body, ctx(req)));
}

function remove(req, res) {
  ok(res, itemService.deleteItem(req.params.id, ctx(req)));
}

function sell(req, res) {
  ok(res, itemService.sellItem(req.params.id, req.body, ctx(req)));
}

function unsell(req, res) {
  ok(res, itemService.unsellItem(req.params.id, ctx(req)));
}

function offSale(req, res) {
  ok(res, itemService.markOffSale(req.params.id, ctx(req)));
}

function forSale(req, res) {
  ok(res, itemService.markForSale(req.params.id, ctx(req)));
}

// Holding em lote (9.5.1a).
function bulkOffSale(req, res) {
  ok(res, itemService.bulkMarkOffSale(req.body, ctx(req)));
}

function bulkForSale(req, res) {
  ok(res, itemService.bulkMarkForSale(req.body, ctx(req)));
}

module.exports = { list, groups, sales, stats, getById, create, update, remove, sell, unsell, offSale, forSale, bulkOffSale, bulkForSale };
