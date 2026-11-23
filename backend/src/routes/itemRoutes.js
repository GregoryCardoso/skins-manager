const { Router } = require('express');
const controller = require('../controllers/itemController');
const validateIdParam = require('../middlewares/validateIdParam');
const v = require('../middlewares/itemValidators');

const { requireJsonForWrites } = require('../middlewares/validationHelpers');

const router = Router();
router.use(requireJsonForWrites);

router.get('/', v.validateItemQuery, controller.list);
router.get('/groups', v.validateGroupQuery, controller.groups); // antes de /:id
router.get('/stats', v.validateStatsQuery, controller.stats); // antes de /:id
router.get('/sales', v.validateSalesQuery, controller.sales); // antes de /:id
router.post('/', v.validateCreateItemBody, controller.create);
router.post('/bulk/off-sale', v.validateBulkSaleStateBody, controller.bulkOffSale); // antes de /:id
router.post('/bulk/for-sale', v.validateBulkSaleStateBody, controller.bulkForSale); // antes de /:id
router.get('/:id', validateIdParam, controller.getById);
router.patch('/:id', validateIdParam, v.validateUpdateItemBody, controller.update);
router.delete('/:id', validateIdParam, controller.remove);
router.post('/:id/sell', validateIdParam, v.validateSellBody, controller.sell);
router.post('/:id/unsell', validateIdParam, v.validateUnsellBody, controller.unsell);
router.post('/:id/off-sale', validateIdParam, v.validateSaleStateBody, controller.offSale);
router.post('/:id/for-sale', validateIdParam, v.validateSaleStateBody, controller.forSale);

module.exports = router;
