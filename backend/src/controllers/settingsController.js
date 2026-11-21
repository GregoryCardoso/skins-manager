const settingsService = require('../services/settingsService');

function get(req, res) {
  res.json({ success: true, data: settingsService.getSettings() });
}

function updateFxRate(req, res) {
  const data = settingsService.updateFxRate(req.body.usdBrlRate, { now: req.app.locals.now() });
  res.json({ success: true, data });
}

function updatePreferences(req, res) {
  const data = settingsService.updatePreferences(req.body, { now: req.app.locals.now() });
  res.json({ success: true, data });
}

async function refreshPtax(req, res) {
  const data = await settingsService.refreshFxRateFromPtax({
    fetchFn: req.app.locals.fetchFn,
    now: req.app.locals.now(),
  });
  res.json({ success: true, data });
}

module.exports = { get, updateFxRate, updatePreferences, refreshPtax };
