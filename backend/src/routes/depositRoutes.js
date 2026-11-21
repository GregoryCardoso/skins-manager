const { Router } = require('express');
const controller = require('../controllers/depositController');
const validateIdParam = require('../middlewares/validateIdParam');
const { validateDepositCreateBody, validateDepositPatchBody } = require('../middlewares/depositValidators');
const { requireJsonForWrites } = require('../middlewares/validationHelpers');

const router = Router();
router.use(requireJsonForWrites);

router.get('/', controller.list);
router.post('/', validateDepositCreateBody, controller.create);
router.patch('/:id', validateIdParam, validateDepositPatchBody, controller.update);
router.delete('/:id', validateIdParam, controller.remove);

module.exports = router;
