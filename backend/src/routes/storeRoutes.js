const { Router } = require('express');
const controller = require('../controllers/storeController');
const { validateStoreQuery } = require('../middlewares/storeValidators');

const router = Router();

router.get('/', validateStoreQuery, controller.list);

module.exports = router;
