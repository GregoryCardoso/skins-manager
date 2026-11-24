'use strict';

const marketValueService = require('../services/valuation/marketValueService');

const ok = (res, data) => res.json({ success: true, data });

async function refresh(req, res) {
  ok(res, await marketValueService.refreshPrices({ now: req.app.locals.now(), fetchFn: req.app.locals.fetchFn, sleepFn: req.app.locals.sleepFn }));
}

function summary(req, res) {
  ok(res, marketValueService.getSummary({ now: req.app.locals.now() }));
}

module.exports = { refresh, summary };
