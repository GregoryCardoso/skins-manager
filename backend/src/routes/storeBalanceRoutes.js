const { Router } = require('express');
const controller = require('../controllers/storeBalanceController');
const validateIdParam = require('../middlewares/validateIdParam');
const { validateStoreBalanceCreateBody, validateStoreBalanceQuery } = require('../middlewares/storeBalanceValidators');
const { requireJsonForWrites } = require('../middlewares/validationHelpers');

const router = Router();
router.use(requireJsonForWrites);

router.get('/', validateStoreBalanceQuery, controller.list);
router.get('/current', controller.current);
router.post('/', validateStoreBalanceCreateBody, controller.create);
router.delete('/:id', validateIdParam, controller.remove);

module.exports = router;
