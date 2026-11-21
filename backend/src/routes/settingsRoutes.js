const { Router } = require('express');
const controller = require('../controllers/settingsController');
const { validateFxRateBody, validatePreferencesBody, validatePtaxRefreshBody } = require('../middlewares/settingsValidators');

const router = Router();

router.get('/', controller.get);
router.patch('/', validatePreferencesBody, controller.updatePreferences);
router.put('/fx-rate', validateFxRateBody, controller.updateFxRate);
router.post('/fx-rate/ptax', validatePtaxRefreshBody, controller.refreshPtax);

module.exports = router;
