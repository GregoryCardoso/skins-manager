'use strict';

const { Router } = require('express');
const controller = require('../controllers/integrationController');
const { requireJsonForWrites } = require('../middlewares/validationHelpers');
const {
  validateIntegrationPatchBody, validateApiKeyBody, validateEmptyBody, validateSwitchAccountBody,
} = require('../middlewares/integrationValidators');

const router = Router();
router.use(requireJsonForWrites);

router.get('/csfloat', controller.getCsfloat);
router.patch('/csfloat', validateIntegrationPatchBody, controller.updateCsfloat);
router.put('/csfloat/api-key', validateApiKeyBody, controller.saveApiKey);
router.delete('/csfloat/api-key', controller.removeApiKey);
router.post('/csfloat/test', validateEmptyBody, controller.testConnection);
router.post('/csfloat/switch-account', validateSwitchAccountBody, controller.switchAccount);

module.exports = router;
