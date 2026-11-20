const { Router } = require('express');
const controller = require('../controllers/storeController');
const validateIdParam = require('../middlewares/validateIdParam');
const { validateStoreQuery, validateSaleQuoteQuery } = require('../middlewares/storeValidators');

const router = Router();

router.get('/', validateStoreQuery, controller.list);
router.get('/:id/sale-quote', validateIdParam, validateSaleQuoteQuery, controller.saleQuote);

module.exports = router;
