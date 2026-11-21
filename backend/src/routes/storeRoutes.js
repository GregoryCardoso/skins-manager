const { Router } = require('express');
const controller = require('../controllers/storeController');
const validateIdParam = require('../middlewares/validateIdParam');
const {
  validateStoreQuery, validateSaleQuoteQuery, validateStoreCreateBody, validateStorePatchBody,
} = require('../middlewares/storeValidators');

const router = Router();

router.get('/', validateStoreQuery, controller.list);
router.post('/', validateStoreCreateBody, controller.create);
router.get('/:id/sale-quote', validateIdParam, validateSaleQuoteQuery, controller.saleQuote);
router.get('/:id', validateIdParam, controller.getById);
router.patch('/:id', validateIdParam, validateStorePatchBody, controller.update);
router.delete('/:id', validateIdParam, controller.remove);

module.exports = router;
