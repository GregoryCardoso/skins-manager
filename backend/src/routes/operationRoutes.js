const { Router } = require('express');
const controller = require('../controllers/itemOperationController');
const validateIdParam = require('../middlewares/validateIdParam');
const v = require('../middlewares/operationValidators');
const { requireJsonForWrites } = require('../middlewares/validationHelpers');

const router = Router();
router.use(requireJsonForWrites);

router.post('/:id/undo', validateIdParam, v.validateUndoBody, controller.undo);

module.exports = router;
