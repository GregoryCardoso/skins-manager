const { Router } = require('express');
const controller = require('../controllers/catalogController');
const v = require('../middlewares/catalogValidators');

const { requireJsonForWrites } = require('../middlewares/validationHelpers');

const router = Router();
router.use(requireJsonForWrites);

router.get('/status', controller.status); // /status e /search antes de /:id
router.get('/search', v.validateCatalogSearchQuery, controller.search);
router.post('/refresh', v.validateRefreshBody, controller.refresh);
router.get('/:id', v.validateCatalogIdParam, controller.getById);

module.exports = router;
