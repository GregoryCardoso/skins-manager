const { Router } = require('express');
const controller = require('../controllers/settingsController');
const { validateFxRateBody, validatePreferencesBody, validateFxRefreshBody } = require('../middlewares/settingsValidators');

const { requireJsonForWrites } = require('../middlewares/validationHelpers');

const router = Router();
router.use(requireJsonForWrites);

router.get('/', controller.get);
router.patch('/', validatePreferencesBody, controller.updatePreferences);
router.put('/fx-rate', validateFxRateBody, controller.updateFxRate);
router.post('/fx-rate/refresh', validateFxRefreshBody, controller.refreshFxRate);

module.exports = router;
