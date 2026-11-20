const { Router } = require('express');
const controller = require('../controllers/itemController');
const validateIdParam = require('../middlewares/validateIdParam');
const v = require('../middlewares/itemValidators');

const router = Router();

router.get('/', v.validateItemQuery, controller.list);
router.get('/stats', v.validateStatsQuery, controller.stats); // antes de /:id
router.post('/', v.validateCreateItemBody, controller.create);
router.get('/:id', validateIdParam, controller.getById);
router.patch('/:id', validateIdParam, v.validateUpdateItemBody, controller.update);
router.delete('/:id', validateIdParam, controller.remove);
router.post('/:id/sell', validateIdParam, v.validateSellBody, controller.sell);
router.post('/:id/unsell', validateIdParam, v.validateUnsellBody, controller.unsell);

module.exports = router;
