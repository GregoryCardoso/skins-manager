const { Router } = require('express');
const controller = require('../controllers/settingsController');
const { validateFxRateBody, validatePreferencesBody } = require('../middlewares/settingsValidators');

const router = Router();

router.get('/', controller.get);
router.patch('/', validatePreferencesBody, controller.updatePreferences);
router.put('/fx-rate', validateFxRateBody, controller.updateFxRate);

module.exports = router;
