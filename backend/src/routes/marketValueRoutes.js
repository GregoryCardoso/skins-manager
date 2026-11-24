'use strict';

const { Router } = require('express');
const controller = require('../controllers/marketValueController');
const { requireJsonForWrites } = require('../middlewares/validationHelpers');
const { validateRefreshBody } = require('../middlewares/marketValueValidators');

const router = Router();
router.use(requireJsonForWrites);

router.post('/refresh', validateRefreshBody, controller.refresh);
router.get('/summary', controller.summary);

module.exports = router;
