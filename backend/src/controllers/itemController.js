const itemService = require('../services/itemService');

const ctx = (req) => ({ now: req.app.locals.now() });
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

function list(req, res) {
  ok(res, itemService.listItems(req.validatedQuery, ctx(req)));
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
  ok(res, itemService.deleteItem(req.params.id));
}

function sell(req, res) {
  ok(res, itemService.sellItem(req.params.id, req.body, ctx(req)));
}

function unsell(req, res) {
  ok(res, itemService.unsellItem(req.params.id, ctx(req)));
}

module.exports = { list, sales, stats, getById, create, update, remove, sell, unsell };
