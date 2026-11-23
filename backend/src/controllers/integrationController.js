'use strict';

const integrationService = require('../services/integrationService');

const ok = (res, data) => res.json({ success: true, data });

function getCsfloat(req, res) {
  ok(res, integrationService.getStatus());
}

function updateCsfloat(req, res) {
  ok(res, integrationService.updateSettings(req.body, { now: req.app.locals.now() }));
}

function saveApiKey(req, res) {
  ok(res, integrationService.saveApiKey(req.body.apiKey, { now: req.app.locals.now() }));
}

function removeApiKey(req, res) {
  ok(res, integrationService.removeApiKey({ now: req.app.locals.now() }));
}

async function testConnection(req, res) {
  ok(res, await integrationService.testConnection({ fetchFn: req.app.locals.fetchFn, now: req.app.locals.now() }));
}

async function switchAccount(req, res) {
  const data = await integrationService.switchAccount({
    confirm: req.body ? req.body.confirm : undefined,
    fetchFn: req.app.locals.fetchFn,
    now: req.app.locals.now(),
  });
  ok(res, data);
}

module.exports = { getCsfloat, updateCsfloat, saveApiKey, removeApiKey, testConnection, switchAccount };
