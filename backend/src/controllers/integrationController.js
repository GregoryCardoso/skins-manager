'use strict';

const integrationService = require('../services/integrationService');
const balanceCheckService = require('../services/imports/balanceCheckService');

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

// Conferência do saldo com o CSFloat (9.7, D313): só leitura.
async function balanceCheck(req, res) {
  ok(res, await balanceCheckService.checkBalance({ fetchFn: req.app.locals.fetchFn, now: req.app.locals.now() }));
}

async function balanceExplain(req, res) {
  ok(res, await balanceCheckService.explainDifference({
    fetchFn: req.app.locals.fetchFn, sleepFn: req.app.locals.sleepFn, now: req.app.locals.now(),
  }));
}

module.exports = { getCsfloat, updateCsfloat, saveApiKey, removeApiKey, testConnection, switchAccount, balanceCheck, balanceExplain };
