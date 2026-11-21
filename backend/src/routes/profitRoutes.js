const { Router } = require('express');
const controller = require('../controllers/profitController');
const { requireJsonForWrites } = require('../middlewares/validationHelpers');

const router = Router();
router.use(requireJsonForWrites);

router.get('/summary', controller.summary);

module.exports = router;
