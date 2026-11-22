const { Router } = require('express');
const controller = require('../controllers/storeBalanceController');
const validateIdParam = require('../middlewares/validateIdParam');
const {
  validateStoreBalanceCheckBody, validateStoreBalanceQuery, validateCheckPreviewQuery,
} = require('../middlewares/storeBalanceValidators');
const { requireJsonForWrites } = require('../middlewares/validationHelpers');

const router = Router();
router.use(requireJsonForWrites);

router.get('/', validateStoreBalanceQuery, controller.list);
router.get('/current', controller.current);
router.get('/check-preview', validateCheckPreviewQuery, controller.checkPreview);
router.post('/', validateStoreBalanceCheckBody, controller.createCheck);
router.delete('/:id', validateIdParam, controller.remove);

module.exports = router;
