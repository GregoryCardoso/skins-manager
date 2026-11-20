const { Router } = require('express');
const controller = require('../controllers/settingsController');
const { validateFxRateBody } = require('../middlewares/settingsValidators');

const router = Router();

router.get('/', controller.get);
router.put('/fx-rate', validateFxRateBody, controller.updateFxRate);

module.exports = router;
