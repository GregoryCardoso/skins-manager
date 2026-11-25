const settingsService = require('../services/settingsService');

function get(req, res) {
  res.json({ success: true, data: settingsService.getSettings() });
}

function updateFxRate(req, res) {
  const data = settingsService.setFxRate(req.body.currency, req.body.rate, { now: req.app.locals.now() });
  res.json({ success: true, data });
}

function updatePreferences(req, res) {
  const data = settingsService.updatePreferences(req.body, { now: req.app.locals.now() });
  res.json({ success: true, data });
}

async function refreshFxRate(req, res) {
  const data = await settingsService.refreshFxRate({
    currency: req.body && req.body.currency !== undefined ? req.body.currency : 'BRL',
    source: req.body ? req.body.source : undefined,
    fetchFn: req.app.locals.fetchFn,
    now: req.app.locals.now(),
    trigger: req.body && req.body.trigger === 'AUTO' ? 'AUTO' : 'MANUAL',
  });
  res.json({ success: true, data });
}

function updateSteamStore(req, res) {
  const data = settingsService.setSteamStore(req.body.storeId, { now: req.app.locals.now() });
  res.json({ success: true, data });
}

function currencyChangePreview(req, res) {
  res.json({ success: true, data: settingsService.getCurrencyChangePreview(req.query.currency) });
}

module.exports = { currencyChangePreview, updateSteamStore, get, updateFxRate, updatePreferences, refreshFxRate };
