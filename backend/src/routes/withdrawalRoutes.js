const { Router } = require('express');
const controller = require('../controllers/withdrawalController');
const validateIdParam = require('../middlewares/validateIdParam');
const {
  validateWithdrawalCreateBody, validateWithdrawalPatchBody, validateFeeSuggestionQuery,
} = require('../middlewares/withdrawalValidators');
const { requireJsonForWrites } = require('../middlewares/validationHelpers');

const router = Router();
router.use(requireJsonForWrites);

router.get('/', controller.list);
router.get('/fee-suggestion', validateFeeSuggestionQuery, controller.feeSuggestion);
router.post('/', validateWithdrawalCreateBody, controller.create);
router.patch('/:id', validateIdParam, validateWithdrawalPatchBody, controller.update);
router.delete('/:id', validateIdParam, controller.remove);

module.exports = router;
